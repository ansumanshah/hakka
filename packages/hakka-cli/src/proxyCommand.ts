import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { startProxyCapture, type ProxyOptions } from './proxy/index'

export function proxyUsage(): string {
  return 'Usage: hakka proxy [--port 8080] [--bridge-url ws://localhost:8989] [--host 127.0.0.1] [--allow-lan] [--config-dir path] [--map-config mappings.json] [--har output.har] [--session output.hakka] [--mitmdump <path>] [--duration-ms <n>] [--json] [--cert-info]'
}

export interface ParsedProxyOptions extends ProxyOptions {
  certHelp?: boolean
  certInfo?: boolean
  durationMs?: number
  json?: boolean
}

export function parseProxyArgs(args: string[]): ParsedProxyOptions {
  const options: ParsedProxyOptions = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    const next = (): string => {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`)
      return value
    }
    if (arg === '--port') options.port = Number(next())
    else if (arg === '--bridge-url') options.bridgeUrl = next()
    else if (arg === '--host') options.host = next()
    else if (arg === '--allow-lan') options.allowLan = true
    else if (arg === '--max-capture-body') options.maxCaptureBody = Number(next())
    else if (arg === '--map-config') options.mapConfig = next()
    else if (arg === '--har') options.harOutput = next()
    else if (arg === '--session') options.sessionOutput = next()
    else if (arg === '--mitmdump') options.mitmdumpPath = next()
    else if (arg === '--config-dir') options.configDir = next()
    else if (arg === '--duration-ms') options.durationMs = Number(next())
    else if (arg === '--json') options.json = true
    else if (arg === '--cert-help') options.certHelp = true
    else if (arg === '--cert-info') options.certInfo = true
    else if (arg === '--help' || arg === '-h') options.certHelp = true
    else throw new Error(`Unknown proxy option: ${arg}`)
  }
  if (options.allowLan && options.host === undefined) options.host = '0.0.0.0'
  return options
}

export async function runProxyCommand(args: string[]): Promise<void> {
  let options: ParsedProxyOptions | undefined = args.includes('--json') ? { json: true } : undefined
  try {
    const parsed = parseProxyArgs(args)
    options = parsed
    const emit = (status: string, detail: Record<string, unknown> = {}): void => {
      if (parsed.json) process.stdout.write(`${JSON.stringify({ command: 'proxy', status, ...detail })}\n`)
      else if (status === 'error') process.stderr.write(`hakka proxy: ${String(detail.message)}\n`)
    }
    const certificates = () => {
      const configDir = parsed.configDir ? resolve(parsed.configDir) : undefined
      const publicCaPath = configDir ? resolve(configDir, 'mitmproxy-ca-cert.pem') : undefined
      return {
        configDir,
        publicCaPath,
        publicCaExists: publicCaPath ? existsSync(publicCaPath) : false,
        privateKeyExposed: false,
      }
    }
    if (parsed.certInfo) {
      if (parsed.json) emit('cert-info', { certificates: certificates() })
      else process.stdout.write(`${JSON.stringify(certificates())}\n`)
      return
    }
    if (parsed.certHelp) {
      const message =
        "HTTPS interception requires client trust in mitmproxy's local CA. Start the proxy, visit http://mitm.it through that proxy, and trust only the generated CA for this task or test profile. Hakka never installs a system CA, changes the system proxy, bypasses certificate pinning, or exposes private keys."
      if (parsed.json) emit('help', { message })
      else process.stdout.write(`${proxyUsage()}\n\n${message}\n`)
      return
    }
    if (parsed.durationMs !== undefined && (!Number.isInteger(parsed.durationMs) || parsed.durationMs < 0))
      throw new Error('--duration-ms must be a non-negative integer.')
    const controller = new AbortController()
    let capture: Awaited<ReturnType<typeof startProxyCapture>> | undefined
    let cancelled = false
    let started = false
    let lastStatus = 0
    const flowIds = new Set<string>()
    const emitStatus = (force = false): void => {
      if (!parsed.json || !started) return
      const now = Date.now()
      if (!force && now - lastStatus < 250) return
      lastStatus = now
      emit('status', { records: flowIds.size })
    }
    const interrupt = (): void => {
      cancelled = true
      controller.abort()
      if (capture) void capture.stop()
    }
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', interrupt)
    try {
      capture = await startProxyCapture({
        ...parsed,
        signal: controller.signal,
        onDiagnostic: (message) => emit('diagnostic', { message }),
        onRecord: (record) => {
          flowIds.add(record.id)
          emitStatus()
        },
      })
    } catch (error) {
      if (cancelled) {
        process.removeListener('SIGINT', interrupt)
        process.removeListener('SIGTERM', interrupt)
        emit('stopped', { records: flowIds.size, certificates: certificates() })
        return
      }
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', interrupt)
      throw error
    }
    if (cancelled) {
      await capture.stop()
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', interrupt)
      emit('stopped', { records: flowIds.size, certificates: certificates() })
      return
    }
    const port = parsed.port ?? 8080
    const host = parsed.host ?? '127.0.0.1'
    emit('started', { host, port, bridgeUrl: parsed.bridgeUrl ?? 'ws://localhost:8989', certificates: certificates() })
    started = true
    if (!parsed.json)
      process.stdout.write(
        `Hakka proxy listening on ${host}:${port}. Configure only the target app or command to use this proxy. Press Ctrl-C to stop.\n`,
      )
    let timer: ReturnType<typeof setTimeout> | undefined
    if (parsed.durationMs !== undefined) timer = setTimeout(() => void capture?.stop(), parsed.durationMs)
    try {
      await capture.wait()
    } finally {
      if (timer) clearTimeout(timer)
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', interrupt)
    }
    emit('stopped', { records: flowIds.size, certificates: certificates() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options?.json) process.stdout.write(`${JSON.stringify({ command: 'proxy', status: 'error', message })}\n`)
    else process.stderr.write(`hakka proxy: ${message}\n`)
    process.exitCode = 1
  }
}
