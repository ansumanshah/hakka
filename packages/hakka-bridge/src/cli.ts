#!/usr/bin/env node
import { DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT, startBridgeServer } from './server'

function resolvePort(argv: string[]): number {
  const flag = argv.indexOf('--port')
  if (flag >= 0) {
    const value = Number(argv[flag + 1])
    if (Number.isInteger(value) && value > 0 && value < 65_536) return value
  }
  const env = Number(process.env.HAKKA_BRIDGE_PORT)
  if (Number.isInteger(env) && env > 0 && env < 65_536) return env
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const port = resolvePort(argv)
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

void main()
