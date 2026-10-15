#!/usr/bin/env node
import { DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT, startBridgeServer } from './server'

const USAGE = `Usage: hakka-bridge [options]

Starts the Hakka bridge hub that SDKs, the browser overlay, and the desktop app connect to.

Options:
  --port <number>   Port to listen on (default ${DEFAULT_BRIDGE_PORT}, or HAKKA_BRIDGE_PORT)
  --host <address>  Interface to bind (default ${DEFAULT_BRIDGE_HOST}, or HAKKA_BRIDGE_HOST)
  --no-mdns         Do not advertise the hub on the LAN (or HAKKA_NO_MDNS=1)
  -h, --help        Show this help`

/** A bad command line: printed as one line, exit code 2. */
class UsageError extends Error {}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value < 65_536
}

function resolvePort(argv: string[]): number {
  const flag = argv.indexOf('--port')
  if (flag >= 0) {
    const raw = argv[flag + 1]
    const value = Number(raw)
    if (raw === undefined || raw.trim() === '' || !isValidPort(value)) {
      throw new UsageError(
        `--port must be a whole number from 1 to 65535, got ${raw === undefined ? 'nothing' : `"${raw}"`}.`,
      )
    }
    return value
  }
  const env = Number(process.env.HAKKA_BRIDGE_PORT)
  if (isValidPort(env)) return env
  return DEFAULT_BRIDGE_PORT
}

/**
 * Bind address — `--host` flag or `HAKKA_BRIDGE_HOST` env var. Stays loopback-only
 * (`DEFAULT_BRIDGE_HOST`) unless a device on the LAN needs to reach this hub directly,
 * e.g. to be found via mDNS discovery (see `resolveAdvertise` below) — opening this up is
 * a deliberate per-run choice, never the default.
 */
function resolveHost(argv: string[]): string {
  const flag = argv.indexOf('--host')
  if (flag >= 0 && argv[flag + 1]) return argv[flag + 1]
  return process.env.HAKKA_BRIDGE_HOST ?? DEFAULT_BRIDGE_HOST
}

/** Opt-out for LAN mDNS advertising — `--no-mdns` flag or `HAKKA_NO_MDNS=1` env var. */
function resolveAdvertise(argv: string[]): boolean {
  if (argv.includes('--no-mdns')) return false
  const env = process.env.HAKKA_NO_MDNS
  if (env === '1' || env?.toLowerCase() === 'true') return false
  return true
}

/** The port `main` tried to bind, for the failure message. */
let requestedPort = DEFAULT_BRIDGE_PORT

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return
  }
  const port = resolvePort(argv)
  requestedPort = port
  const host = resolveHost(argv)
  const advertise = resolveAdvertise(argv)
  const server = await startBridgeServer({
    port,
    host,
    advertise,
    onRecord: (request) => {
      const status = request.status != null ? String(request.status) : request.error ? 'ERR' : '...'
      const duration = request.duration != null ? `${Math.round(request.duration)}ms` : ''
      console.log(`${request.method.padEnd(6)} ${status.padEnd(4)} ${request.url} ${duration}`.trimEnd())
    },
  })
  console.log(`hakka-bridge listening on ws://${host}:${server.port}`)
  console.log('Enable "Connect to desktop" in the hakka-browser Settings tab to stream requests here.')
  if (server.mdnsAdvertising) {
    console.log(
      'Advertising on the LAN as _hakka._tcp.local — iOS/Android clients can discover it with no bridgeURL set.',
    )
  }

  const shutdown = (): void => {
    void server.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/** One line for the user, never a stack trace: these are expected failures. */
function describeFailure(error: unknown, port: number): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  if (code === 'EADDRINUSE') {
    return `hakka-bridge: Port ${port} is already in use. Another hub may be running; pick a free one with --port <number>.`
  }
  if (code === 'EACCES') {
    return `hakka-bridge: No permission to listen on port ${port}. Try a port above 1024 with --port.`
  }
  return `hakka-bridge: ${error instanceof Error ? error.message : String(error)}`
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`hakka-bridge: ${error.message} Run hakka-bridge --help for usage.`)
    process.exit(2)
  }
  console.error(describeFailure(error, requestedPort))
  process.exit(1)
})
