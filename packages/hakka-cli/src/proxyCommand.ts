import { startProxyCapture, type ProxyOptions } from './proxy/index'

export function proxyUsage(): string {
  return 'Usage: hakka proxy [--port 8080] [--bridge-url ws://localhost:8989] [--host 127.0.0.1] [--allow-lan] [--max-capture-body 102400] [--map-config mappings.json] [--har output.har] [--session output.hakka] [--mitmdump <path>] [--duration-ms <n>] [--json] [--cert-help]'
}

export interface ParsedProxyOptions extends ProxyOptions {
  certHelp?: boolean
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
    else if (arg === '--duration-ms') options.durationMs = Number(next())
    else if (arg === '--json') options.json = true
    else if (arg === '--cert-help') options.certHelp = true
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
    if (parsed.certHelp) {
      const message =
        "HTTPS interception requires client trust in mitmproxy's local CA. Start the proxy, visit http://mitm.it through that proxy, and trust only the generated CA for this task or test profile. Hakka never installs a system CA, changes the system proxy, bypasses certificate pinning, or exposes private keys."
      if (parsed.json) emit('help', { message })
      else process.stdout.write(`${proxyUsage()}\n\n${message}\n`)
      return
    }
    if (parsed.durationMs !== undefined && (!Number.isInteger(parsed.durationMs) || parsed.durationMs < 0))
      throw new Error('--duration-ms must be a non-negative integer.')
    const capture = await startProxyCapture({
      ...parsed,
      onDiagnostic: (message) => emit('diagnostic', { message }),
    })
    const port = parsed.port ?? 8080
    const host = parsed.host ?? '127.0.0.1'
    emit('started', { host, port, bridgeUrl: parsed.bridgeUrl ?? 'ws://localhost:8989' })
    if (!parsed.json)
      process.stdout.write(
        `Hakka proxy listening on ${host}:${port}. Configure only the target app or command to use this proxy. Press Ctrl-C to stop.\n`,
      )
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const stop = (): void => {
        void capture.stop().then(resolve, reject)
      }
      void capture.wait().catch((error: Error) => {
        void capture.stop().then(() => reject(error), reject)
      })
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      if (parsed.durationMs !== undefined) timer = setTimeout(stop, parsed.durationMs)
      const cleanup = (): void => {
        process.removeListener('SIGINT', stop)
        process.removeListener('SIGTERM', stop)
        if (timer) clearTimeout(timer)
      }
      void capture.wait().then(cleanup, cleanup)
    })
    emit('stopped', { records: capture.records.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options?.json) process.stdout.write(`${JSON.stringify({ command: 'proxy', status: 'error', message })}\n`)
    else process.stderr.write(`hakka proxy: ${message}\n`)
    process.exitCode = 1
  }
}
