import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { buildHar, serializeSession } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

import { createCdpBridgeClient, DEFAULT_BRIDGE_URL } from '../cdp/bridgeClient'
import { mapProxyFlow } from './mapper'
import { loadProxyMappings } from './mapping'
import type { ProxyFlowEvent } from './types'

export interface ProxyOptions {
  port?: number
  host?: string
  /** Required before binding beyond loopback. */
  allowLan?: boolean
  bridgeUrl?: string
  maxCaptureBody?: number
  mapConfig?: string
  harOutput?: string
  sessionOutput?: string
  redactHeaders?: string[]
  redactBodyFields?: string[]
  mitmdumpPath?: string
  onRecord?: (record: NetworkRequest) => void
  onDiagnostic?: (message: string) => void
  /** Bounded readiness timeout; primarily useful for deterministic integration tests. */
  startupTimeoutMs?: number
}

export interface ProxyCapture {
  readonly records: readonly NetworkRequest[]
  /** Rejects when the sidecar exits unexpectedly after it became ready. */
  wait(): Promise<void>
  stop(): Promise<void>
}

const DEFAULT_PORT = 8080
const MAX_RECORDS = 10_000

function addonPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [resolve(here, 'hakka_mitm_addon.py'), resolve(here, '../src/proxy/hakka_mitm_addon.py')]
  const found = candidates.find(existsSync)
  if (!found)
    throw new Error(
      'Hakka proxy addon is missing from this installation. Reinstall hakka-cli or build with src/proxy/hakka_mitm_addon.py included.',
    )
  return found
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
  const mitmdump = options.mitmdumpPath ?? 'mitmdump'
  if (!commandExists(mitmdump))
    throw new Error(
      `mitmdump was not found at ${mitmdump}. Install mitmproxy (for example: brew install mitmproxy) or pass --mitmdump <path>.`,
    )
  const mappings = loadProxyMappings(options.mapConfig)
  const args = [
    '--listen-host',
    host,
    '--listen-port',
    String(port),
    '--set',
    'termlog_verbosity=error',
    '-s',
    addonPath(),
  ]
  for (const rule of mappings.mapLocal) args.push('--map-local', rule)
  for (const rule of mappings.mapRemote) args.push('--map-remote', rule)
  const child = spawn(mitmdump, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HAKKA_PROXY_SIDECAR_BODY_BYTES: String(maxCaptureBody) },
  })
  const bridge = createCdpBridgeClient({ url: options.bridgeUrl ?? DEFAULT_BRIDGE_URL })
  const report = options.onDiagnostic ?? ((message: string) => process.stderr.write(`hakka proxy: ${message}\n`))
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
  child.once('error', (error) => {
    startupError = new Error(`mitmdump could not start: ${error.message}`)
    rejectTerminal(startupError)
  })
  child.once('exit', (code, signal) => {
    if (stopping) resolveTerminal()
    else
      rejectTerminal(
        startupError ??
          new Error(
            `mitmdump exited before capture completed (code ${code ?? 'unknown'}, signal ${signal ?? 'none'}).`,
          ),
      )
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    // mitmproxy diagnostics stay on stderr; do not reflect them to the JSONL parser.
    const concise = chunk.trim()
    if (concise) report(concise)
  })
  const records: NetworkRequest[] = []
  let resolveReady: (() => void) | undefined
  let rejectReady: ((error: Error) => void) | undefined
  const ready = new Promise<void>((resolveReadyPromise, rejectReadyPromise) => {
    resolveReady = resolveReadyPromise
    rejectReady = rejectReadyPromise
  })
  void ready.catch(() => {})
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (line === '{"type":"ready"}') {
      resolveReady?.()
      return
    }
    const event = parseEvent(line)
    if (!event) return
    const record = mapProxyFlow(event, {
      maxBodySize: maxCaptureBody,
      redactHeaders: options.redactHeaders,
      redactBodyFields: options.redactBodyFields,
    })
    records.push(record)
    if (records.length > MAX_RECORDS) records.shift()
    bridge.send(record)
    options.onRecord?.(record)
  })
  const timeoutMs = options.startupTimeoutMs ?? 2_000
  const readyTimer = setTimeout(
    () => rejectReady?.(new Error(`mitmdump did not report ready within ${timeoutMs}ms.`)),
    timeoutMs,
  )
  void exited.catch((error: Error) => rejectReady?.(error))
  await ready
    .finally(() => clearTimeout(readyTimer))
    .catch(async (error: unknown) => {
      stopping = true
      child.kill('SIGTERM')
      await exited.catch(() => {})
      bridge.close()
      throw error
    })
  return {
    get records() {
      return records
    },
    wait() {
      return exited
    },
    async stop() {
      if (stopping) return exited.catch(() => {})
      stopping = true
      child.kill('SIGTERM')
      try {
        await Promise.race([exited.catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
        if (!terminalSettled) {
          child.kill('SIGKILL')
          await exited.catch(() => {})
        }
        if (options.harOutput) writeFileSync(options.harOutput, JSON.stringify(buildHar(records), null, 2))
        if (options.sessionOutput)
          writeFileSync(options.sessionOutput, serializeSession(records, { source: 'hakka proxy' }))
      } finally {
        bridge.close()
      }
    },
  }
}
