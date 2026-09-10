import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { createServer, isIP } from 'node:net'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'

import { buildHar, serializeSession } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

import { createCdpBridgeClient, DEFAULT_BRIDGE_URL } from '../cdp/bridgeClient'
import { bandwidthEnvironment, resolveProxyBandwidth, type ProxyBandwidthConfig } from './bandwidth'
import { mapProxyFlow } from './mapper'
import { loadProxyConfiguration } from './mapping'
import { createProxyBreakpointBridge } from './ProxyBreakpointBridge'
import { startProxyRoutingServer, type PreparedProxyRouting } from './ProxyRoutingServer'
import { createProxyScriptBridge, type ProxyScriptBridge } from './ProxyScriptBridge'
import { PROXY_SCRIPT_MAX_BODY_BYTES } from './ProxyScriptSandbox'
import { proxySupportPath } from './proxySupportPath'
import { buildMitmproxyHostArgs, type TlsHostScope } from './tlsHostScope'
import type { ProxyFlowEvent } from './types'
import { buildUpstreamProxyArgs } from './upstreamProxy'

export interface ProxyOptions {
  port?: number
  host?: string
  /** Required before binding beyond loopback. */
  allowLan?: boolean
  bridgeUrl?: string
  /** Enables live traffic mutation through desktop breakpoint rules for this launch only. */
  enableBreakpoints?: boolean
  maxCaptureBody?: number
  mapConfig?: string
  tlsHostScope?: TlsHostScope
  upstreamProxy?: string
  /** Validated direct/upstream/PAC routing file. Credentials remain outside process arguments. */
  routingConfig?: string
  /** User-selected JavaScript file executed in a bounded QuickJS runtime for this launch. */
  scriptPath?: string
  /** Immutable latency/offline/bandwidth conditions for this launch. */
  bandwidth?: ProxyBandwidthConfig
  harOutput?: string
  sessionOutput?: string
  redactHeaders?: string[]
  redactBodyFields?: string[]
  mitmdumpPath?: string
  /** Task-local mitmproxy configuration directory. Hakka never reads private key material. */
  configDir?: string
  onRecord?: (record: NetworkRequest) => void
  onDiagnostic?: (message: string) => void
  /** Both live-breakpoint control sockets are ready; stored rules may now be rebroadcast. */
  onBreakpointReady?: () => void
  /** Bounded readiness timeout; primarily useful for deterministic integration tests. */
  startupTimeoutMs?: number
  /** Internal live-pause watchdog override for deterministic integration tests. Maximum 60 seconds. */
  breakpointTimeoutMs?: number
  /** Cancels startup or stops an active capture, including exports and cleanup. */
  signal?: AbortSignal
}

export interface ProxyCapture {
  readonly records: readonly NetworkRequest[]
  /** Rejects when the sidecar exits unexpectedly after it became ready. */
  wait(): Promise<void>
  stop(): Promise<void>
}

const DEFAULT_PORT = 8080
const MAX_RECORDS = 10_000

async function availableLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a private proxy port.')
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  return address.port
}

function terminateProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolveStop) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveStop()
    }
    child.once('close', finish)
    child.kill('SIGTERM')
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish()
    }, 2_000)
  })
}

interface BandwidthRelay {
  close(): Promise<void>
}

async function startBandwidthRelay(options: {
  host: string
  port: number
  targetPort: number
  bandwidth: ReturnType<typeof resolveProxyBandwidth>
  timeoutMs: number
  report: (message: string) => void
  onUnexpectedExit: (error: Error) => void
}): Promise<BandwidthRelay> {
  const args = [
    proxySupportPath('bandwidth_relay.py'),
    '--listen-host',
    options.host,
    '--listen-port',
    String(options.port),
    '--target-port',
    String(options.targetPort),
  ]
  if (options.bandwidth.uploadBytesPerSecond) args.push('--upload-bps', String(options.bandwidth.uploadBytesPerSecond))
  if (options.bandwidth.downloadBytesPerSecond)
    args.push('--download-bps', String(options.bandwidth.downloadBytesPerSecond))
  const child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let closing = false
  let ready = false
  let resolveReady: (() => void) | undefined
  let rejectReady: ((error: Error) => void) | undefined
  const readiness = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise
    rejectReady = rejectPromise
  })
  child.once('error', (error) => rejectReady?.(new Error(`Bandwidth relay could not start: ${error.message}`)))
  child.once('close', (code, signal) => {
    const error = new Error(
      `Bandwidth relay exited unexpectedly (code ${code ?? 'unknown'}, signal ${signal ?? 'none'}).`,
    )
    if (!ready) rejectReady?.(error)
    else if (!closing) options.onUnexpectedExit(error)
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    const concise = chunk.trim()
    if (concise) options.report(`bandwidth relay: ${concise}`)
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const event = JSON.parse(line) as { type?: unknown; port?: unknown }
      if (event.type === 'ready' && event.port === options.port) {
        ready = true
        resolveReady?.()
      }
    } catch {
      // Only the bounded readiness envelope is accepted from the relay.
    }
  })
  const timer = setTimeout(
    () => rejectReady?.(new Error(`Bandwidth relay did not report ready within ${options.timeoutMs}ms.`)),
    options.timeoutMs,
  )
  try {
    await readiness.finally(() => clearTimeout(timer))
  } catch (error: unknown) {
    closing = true
    await terminateProcess(child)
    throw error
  }
  let closePromise: Promise<void> | undefined
  return {
    close(): Promise<void> {
      closing = true
      closePromise ??= terminateProcess(child)
      return closePromise
    },
  }
}

function parseEvent(line: string): ProxyFlowEvent | null {
  try {
    const value = JSON.parse(line) as Partial<ProxyFlowEvent>
    if (
      value.type !== 'flow' ||
      typeof value.id !== 'string' ||
      typeof value.url !== 'string' ||
      typeof value.method !== 'string' ||
      typeof value.startedAt !== 'number' ||
      typeof value.endedAt !== 'number' ||
      !Array.isArray(value.requestHeaders)
    )
      return null
    return value as ProxyFlowEvent
  } catch {
    return null
  }
}

function commandExists(path: string): boolean {
  return path.includes('/') ? existsSync(path) : true
}

/** Starts a local mitmdump sidecar. It changes neither the system proxy nor trust store. */
export async function startProxyCapture(options: ProxyOptions = {}): Promise<ProxyCapture> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? DEFAULT_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('--port must be an integer between 1 and 65535.')
  const isLoopback = host === '127.0.0.1' || host === '::1' || host === 'localhost'
  if (!isLoopback && !options.allowLan) throw new Error('A non-loopback --host requires --allow-lan.')
  if (host !== 'localhost' && isIP(host) === 0) throw new Error('--host must be an IP address or localhost.')
  const maxCaptureBody = options.maxCaptureBody ?? 100 * 1024
  if (!Number.isInteger(maxCaptureBody) || maxCaptureBody < 0)
    throw new Error('--max-capture-body must be a non-negative integer.')
  const breakpointTimeoutMs = options.breakpointTimeoutMs ?? 60_000
  if (!Number.isInteger(breakpointTimeoutMs) || breakpointTimeoutMs < 1 || breakpointTimeoutMs > 60_000)
    throw new Error('Proxy breakpoint timeout must be an integer from 1 through 60000 milliseconds.')
  const mitmdump = options.mitmdumpPath ?? 'mitmdump'
  if (!commandExists(mitmdump))
    throw new Error(
      `mitmdump was not found at ${mitmdump}. Install mitmproxy (for example: brew install mitmproxy) or pass --mitmdump <path>.`,
    )
  if (options.routingConfig && options.upstreamProxy)
    throw new Error('--routing-config cannot be combined with --upstream-proxy.')
  const bandwidth = resolveProxyBandwidth(options.bandwidth)
  const usesBandwidthRelay =
    bandwidth.uploadBytesPerSecond !== undefined || bandwidth.downloadBytesPerSecond !== undefined
  const sidecarPort = usesBandwidthRelay ? await availableLoopbackPort() : port
  const sidecarHost = usesBandwidthRelay ? '127.0.0.1' : host
  const mappings = loadProxyConfiguration(options.mapConfig)
  const bridgeUrl = options.bridgeUrl ?? DEFAULT_BRIDGE_URL
  let parsedBridgeURL: URL
  try {
    parsedBridgeURL = new URL(bridgeUrl)
  } catch {
    throw new Error('--bridge-url must be a ws:// or wss:// URL.')
  }
  if (parsedBridgeURL.protocol !== 'ws:' && parsedBridgeURL.protocol !== 'wss:')
    throw new Error('--bridge-url must be a ws:// or wss:// URL.')
  const report = options.onDiagnostic ?? ((message: string) => process.stderr.write(`hakka proxy: ${message}\n`))
  const addon = proxySupportPath('hakka_mitm_addon.py')
  if (options.scriptPath) proxySupportPath('hakka_script_helper.py')
  if (usesBandwidthRelay) proxySupportPath('bandwidth_relay.py')
  const legacyUpstreamArgs = buildUpstreamProxyArgs(options.upstreamProxy)
  const tlsArgs = options.tlsHostScope ? buildMitmproxyHostArgs(options.tlsHostScope) : []
  let routing: PreparedProxyRouting | undefined
  let scriptBridge: ProxyScriptBridge | undefined
  let breakpointBridge: Awaited<ReturnType<typeof createProxyBreakpointBridge>> | undefined
  let child: ChildProcess | undefined
  let bridge: ReturnType<typeof createCdpBridgeClient> | undefined
  try {
    if (options.routingConfig)
      routing = await startProxyRoutingServer(options.routingConfig, {
        forbiddenEndpoints: [
          { host, port },
          { host: sidecarHost, port: sidecarPort },
        ],
      })
    if (options.scriptPath) {
      scriptBridge = await createProxyScriptBridge({ scriptPath: options.scriptPath, onDiagnostic: report })
    }
    if (options.enableBreakpoints)
      breakpointBridge = await createProxyBreakpointBridge({
        bridgeUrl,
        onDiagnostic: report,
        onReady: options.onBreakpointReady,
        redactHeaders: options.redactHeaders,
      })
    const args = [
      '--listen-host',
      sidecarHost,
      '--listen-port',
      String(sidecarPort),
      '--set',
      'termlog_verbosity=error',
      '-s',
      addon,
      ...(routing ? buildUpstreamProxyArgs(routing.proxyURL) : legacyUpstreamArgs),
      ...tlsArgs,
    ]
    if (options.configDir) args.push('--set', `confdir=${resolve(options.configDir)}`)
    for (const rule of mappings.mapLocal) args.push('--map-local', rule)
    for (const rule of mappings.mapRemote) args.push('--map-remote', rule)
    child = spawn(mitmdump, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...routing?.environment,
        ...bandwidthEnvironment(options.bandwidth),
        HAKKA_PROXY_SIDECAR_BODY_BYTES: String(maxCaptureBody),
        ...(breakpointBridge
          ? {
              HAKKA_PROXY_BREAKPOINT_PORT: String(breakpointBridge.addonPort),
              HAKKA_PROXY_BREAKPOINT_TOKEN: breakpointBridge.addonToken,
              HAKKA_PROXY_BREAKPOINT_TIMEOUT_SECONDS: String(breakpointTimeoutMs / 1000),
            }
          : {}),
        ...(mappings.addonConfigPath ? { HAKKA_PROXY_RULE_CONFIG: mappings.addonConfigPath } : {}),
        ...(scriptBridge
          ? {
              HAKKA_PROXY_SCRIPT_PORT: String(scriptBridge.addonPort),
              HAKKA_PROXY_SCRIPT_TOKEN: scriptBridge.addonToken,
              HAKKA_PROXY_SCRIPT_BODY_BYTES: String(PROXY_SCRIPT_MAX_BODY_BYTES),
              HAKKA_PROXY_SCRIPT_TIMEOUT_SECONDS: '0.25',
            }
          : {}),
      },
    })
    bridge = createCdpBridgeClient({ url: bridgeUrl })
  } catch (error: unknown) {
    await Promise.allSettled([
      typeof child === 'undefined' ? undefined : terminateProcess(child),
      Promise.resolve().then(() => bridge?.close()),
      routing?.close(),
      scriptBridge?.close(),
      breakpointBridge?.close(),
    ])
    throw error
  }
  if (!child || !child.stdout || !child.stderr || !bridge) throw new Error('Proxy process setup did not complete.')
  const sidecar = child
  const sidecarOutput = child.stdout
  const sidecarDiagnostics = child.stderr
  const recordBridge = bridge
  let abort = (): void => {}
  let bandwidthRelay: BandwidthRelay | undefined
  let cleanupPromise: Promise<void> | undefined
  const cleanupAuxiliary = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      options.signal?.removeEventListener('abort', abort)
      await Promise.allSettled([
        Promise.resolve().then(() => recordBridge.close()),
        bandwidthRelay?.close(),
        breakpointBridge?.close(),
        scriptBridge?.close(),
        routing?.close(),
      ])
    })()
    return cleanupPromise
  }
  let stopping = false
  let startupError: Error | null = null
  let terminalSettled = false
  let resolveExit: (() => void) | undefined
  let rejectExit: ((error: Error) => void) | undefined
  const exited = new Promise<void>((resolveExitPromise, rejectExitPromise) => {
    resolveExit = resolveExitPromise
    rejectExit = rejectExitPromise
  })
  // Keep a rejection handler attached even when a caller only stops the capture.
  void exited.catch(() => {})
  const rejectTerminal = (error: Error): void => {
    if (terminalSettled) return
    terminalSettled = true
    rejectExit?.(error)
  }
  const resolveTerminal = (): void => {
    if (terminalSettled) return
    terminalSettled = true
    resolveExit?.()
  }
  sidecar.once('error', (error) => {
    startupError = new Error(`mitmdump could not start: ${error.message}`)
    rejectTerminal(startupError)
    void cleanupAuxiliary()
  })
  sidecar.once('close', (code, signal) => {
    if (stopping) resolveTerminal()
    else
      rejectTerminal(
        startupError ??
          new Error(
            `mitmdump exited before capture completed (code ${code ?? 'unknown'}, signal ${signal ?? 'none'}).`,
          ),
      )
    void cleanupAuxiliary()
  })
  const completed = exited.finally(cleanupAuxiliary)
  void completed.catch(() => {})
  sidecarDiagnostics.setEncoding('utf8')
  sidecarDiagnostics.on('data', (chunk: string) => {
    // mitmproxy diagnostics stay on stderr; do not reflect them to the JSONL parser.
    const concise = chunk.trim()
    if (concise) report(concise)
  })
  const records: NetworkRequest[] = []
  const recordIndexes = new Map<string, number>()
  let resolveReady: (() => void) | undefined
  let rejectReady: ((error: Error) => void) | undefined
  const ready = new Promise<void>((resolveReadyPromise, rejectReadyPromise) => {
    resolveReady = resolveReadyPromise
    rejectReady = rejectReadyPromise
  })
  void ready.catch(() => {})
  let stopPromise: Promise<void> | undefined
  let becameReady = false
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise
    stopping = true
    stopPromise = (async () => {
      sidecar.kill('SIGTERM')
      let killTimer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          exited.catch(() => {}),
          new Promise<void>((resolve) => {
            killTimer = setTimeout(resolve, 2_000)
          }),
        ])
        if (!terminalSettled) {
          sidecar.kill('SIGKILL')
          await exited.catch(() => {})
        }
        if (becameReady) {
          if (options.harOutput) writeFileSync(options.harOutput, JSON.stringify(buildHar(records), null, 2))
          if (options.sessionOutput)
            writeFileSync(options.sessionOutput, serializeSession(records, { source: 'hakka proxy' }))
        }
      } finally {
        clearTimeout(killTimer)
        await cleanupAuxiliary()
      }
    })()
    return stopPromise
  }
  abort = (): void => {
    rejectReady?.(new Error('Proxy capture cancelled.'))
    void stop().catch(() => {})
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  createInterface({ input: sidecarOutput }).on('line', (line) => {
    if (line === '{"type":"ready"}') {
      becameReady = true
      resolveReady?.()
      return
    }
    try {
      const diagnostic = JSON.parse(line) as { type?: unknown; message?: unknown }
      if (diagnostic.type === 'diagnostic' && typeof diagnostic.message === 'string') {
        report(diagnostic.message)
        return
      }
    } catch {
      // Flow parsing below owns malformed or unrelated stdout lines.
    }
    const event = parseEvent(line)
    if (!event) return
    const record = mapProxyFlow(event, {
      maxBodySize: maxCaptureBody,
      redactHeaders: options.redactHeaders,
      redactBodyFields: options.redactBodyFields,
    })
    const priorIndex = recordIndexes.get(record.id)
    if (priorIndex === undefined) {
      records.push(record)
      recordIndexes.set(record.id, records.length - 1)
      if (records.length > MAX_RECORDS) {
        const removed = records.shift()
        if (removed) recordIndexes.delete(removed.id)
        for (const [id, index] of recordIndexes) recordIndexes.set(id, index - 1)
      }
    } else {
      records[priorIndex] = record
    }
    recordBridge.send(record)
    options.onRecord?.(record)
  })
  if (options.signal?.aborted) abort()
  const timeoutMs = options.startupTimeoutMs ?? 2_000
  const readyTimer = setTimeout(
    () => rejectReady?.(new Error(`mitmdump did not report ready within ${timeoutMs}ms.`)),
    timeoutMs,
  )
  void exited.catch((error: Error) => rejectReady?.(error))
  await ready
    .finally(() => clearTimeout(readyTimer))
    .catch(async (error: unknown) => {
      await stop().catch(() => {})
      throw error
    })
  if (usesBandwidthRelay) {
    try {
      const relay = await startBandwidthRelay({
        host,
        port,
        targetPort: sidecarPort,
        bandwidth,
        timeoutMs,
        report,
        onUnexpectedExit: (error) => {
          rejectTerminal(error)
          sidecar.kill('SIGTERM')
          void cleanupAuxiliary()
        },
      })
      bandwidthRelay = relay
      if (stopping || terminalSettled) {
        await relay.close()
        await exited
        throw new Error('Proxy capture stopped during bandwidth relay startup.')
      }
    } catch (error: unknown) {
      await stop().catch(() => {})
      throw error
    }
  }
  return {
    get records() {
      return records
    },
    wait() {
      return completed
    },
    stop,
  }
}
