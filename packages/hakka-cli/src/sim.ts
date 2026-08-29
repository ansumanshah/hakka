/**
 * `hakka sim attach <bundle-id>` — launches an iOS Simulator app with
 * Hakka's capture SDK injected via `DYLD_INSERT_LIBRARIES`, reaching apps
 * this repo did not build or link (see ADR 0014,
 * `docs/src/content/docs/contributing/adr/0014-simulator-injection-capture.md`,
 * for the full writeup, exactly what this can and cannot see, and
 * productionisation cost).
 *
 * Thin wrapper around `xcrun simctl` — no simulator SDK, no native code here.
 * Lives in this CLI rather than a standalone script because it is one more
 * capture-acquisition subcommand next to `hakka cdp`, not a separate concern:
 * a developer who already has `hakka` installed to start capture is the
 * right audience, and a second install surface would fragment that.
 *
 * Simulator only, by design — this never touches a physical device.
 *
 * Every `xcrun simctl` call (list/get_app_container/terminate/launch) goes
 * through the single `SimctlRunner` seam so `runSimAttach` is testable
 * end-to-end against a fake runner instead of a real Simulator — see
 * `__tests__/sim.test.ts`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:8989'

export interface SimAttachOptions {
  bundleId: string
  device?: string
  dylibPath?: string
  bridgeUrl?: string
}

interface SimctlDevice {
  udid: string
  name: string
  state: string
}

interface SimctlResult {
  status: number | null
  stdout: string
  stderr: string
}

/** One seam for every `xcrun simctl` invocation — real by default, fake in tests. */
export type SimctlRunner = (args: string[], envOverrides?: NodeJS.ProcessEnv) => SimctlResult

const realSimctlRunner: SimctlRunner = (args, envOverrides) => {
  const result = spawnSync('xcrun', ['simctl', ...args], {
    encoding: 'utf8',
    env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Resolves a target simulator: `--device <udid-or-name>`, or the sole booted device. */
export function resolveDevice(
  deviceArg: string | undefined,
  simctl: SimctlRunner = realSimctlRunner,
): SimctlDevice | { error: string } {
  const { status, stdout, stderr } = simctl(['list', 'devices', '--json'])
  if (status !== 0) {
    return { error: `xcrun simctl list failed: ${stderr.trim() || 'unknown error'}` }
  }
  let parsed: { devices: Record<string, SimctlDevice[]> }
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { error: 'could not parse `xcrun simctl list devices --json` output' }
  }
  const all = Object.values(parsed.devices).flat()

  if (deviceArg) {
    const byUdid = all.find((d) => d.udid === deviceArg)
    if (byUdid) return byUdid
    const byName = all.find((d) => d.name === deviceArg && d.state === 'Booted')
    if (byName) return byName
    return { error: `no booted simulator matches "${deviceArg}" (by UDID or name)` }
  }

  const booted = all.filter((d) => d.state === 'Booted')
  if (booted.length === 0) {
    return { error: 'no booted simulator found. Boot one first (`xcrun simctl boot <name>`), or pass --device' }
  }
  if (booted.length > 1) {
    const names = booted.map((d) => `${d.name} (${d.udid})`).join(', ')
    return { error: `multiple simulators are booted (${names}). Pass --device <udid-or-name>` }
  }
  return booted[0] as SimctlDevice
}

/**
 * `simctl get_app_container` exits 0 with the app's install path when the
 * bundle id is installed on that device, non-zero otherwise. `simctl
 * launch`'s own failure for "not installed" and "no such bundle id" is the
 * identical, generic `FBSOpenApplicationServiceErrorDomain` error either
 * way (verified directly against a real simulator) — this check runs first
 * so the CLI can say something more useful than that shared, opaque text.
 */
export function isAppInstalled(udid: string, bundleId: string, simctl: SimctlRunner = realSimctlRunner): boolean {
  return simctl(['get_app_container', udid, bundleId]).status === 0
}

/**
 * Default build output of `just build-siminject`, computed relative to this
 * module's own file so it resolves correctly both unbundled (`src/sim.ts`,
 * dev/test) and bundled (`dist/cli.mjs`, published) — both sit exactly
 * three path segments below the repo root. Outside a Hakka checkout (an npm
 * install of `hakka-cli` elsewhere) this path simply will not exist, which
 * is the correct outcome: `ios/SimInject` depends on `../ios` by local
 * path, so only someone with this repo can build the dylib at all.
 */
export function defaultDylibPath(moduleDir: string = dirname(fileURLToPath(import.meta.url))): string {
  const repoRoot = resolve(moduleDir, '../../..')
  return join(
    repoRoot,
    'ios/SimInject/.build/xcode-sim/Debug-iphonesimulator/PackageFrameworks/HakkaSimInject.framework/HakkaSimInject',
  )
}

type DylibResolution = { path: string; source: string } | { error: string }

/** `--dylib` flag, then `HAKKA_SIM_INJECT_DYLIB`, then the `just build-siminject` default output. */
export function resolveDylibPath(opts: SimAttachOptions): DylibResolution {
  if (opts.dylibPath) {
    if (!existsSync(opts.dylibPath)) {
      return { error: `dylib not found at ${opts.dylibPath} (passed via --dylib)` }
    }
    return { path: opts.dylibPath, source: '--dylib' }
  }

  const envPath = process.env.HAKKA_SIM_INJECT_DYLIB
  if (envPath) {
    if (!existsSync(envPath)) {
      return { error: `dylib not found at ${envPath} (from HAKKA_SIM_INJECT_DYLIB)` }
    }
    return { path: envPath, source: 'HAKKA_SIM_INJECT_DYLIB' }
  }

  const auto = defaultDylibPath()
  if (existsSync(auto)) {
    return { path: auto, source: 'just build-siminject' }
  }

  return {
    error: [
      'no dylib found.',
      '  Build one: just build-siminject',
      `    (writes to ${auto})`,
      '  Or pass --dylib <path>, or set HAKKA_SIM_INJECT_DYLIB.',
    ].join('\n'),
  }
}

/**
 * Best-effort TCP reachability probe for the bridge hub host:port. Never
 * blocks a launch on this — `HakkaBridgeClient` reconnects on its own
 * schedule, so an unreachable hub at launch time is a "nothing is listening
 * yet" warning, not a fatal error.
 */
export function probeBridgeReachable(bridgeUrl: string, timeoutMs = 400): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(bridgeUrl)
  } catch {
    return Promise.resolve(false)
  }
  const port = Number(parsed.port) || 80

  return new Promise((resolvePromise) => {
    const socket = connect({ host: parsed.hostname, port, timeout: timeoutMs })
    const done = (ok: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolvePromise(ok)
    }
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

export interface SimAttachDeps {
  simctl: SimctlRunner
  probeBridge: (bridgeUrl: string) => Promise<boolean>
}

/** Runs `hakka sim attach <bundle-id>`. Never touches a physical device. */
export async function runSimAttach(
  opts: SimAttachOptions,
  log: (s: string) => void = console.log,
  deps: Partial<SimAttachDeps> = {},
): Promise<number> {
  const simctl = deps.simctl ?? realSimctlRunner
  const probeBridge = deps.probeBridge ?? probeBridgeReachable

  const device = resolveDevice(opts.device, simctl)
  if ('error' in device) {
    log(`hakka sim attach: ${device.error}`)
    return 1
  }

  const dylib = resolveDylibPath(opts)
  if ('error' in dylib) {
    log(`hakka sim attach: ${dylib.error}`)
    return 1
  }

  if (!isAppInstalled(device.udid, opts.bundleId, simctl)) {
    log(`hakka sim attach: "${opts.bundleId}" is not installed on ${device.name} (${device.udid}).`)
    log('  Install it first (drag the .app onto the simulator, or `xcrun simctl install <udid> <path-to-.app>`),')
    log(`  or check the bundle id: \`xcrun simctl listapps ${device.udid}\` lists what is installed.`)
    return 1
  }

  const bridgeUrl = opts.bridgeUrl ?? DEFAULT_BRIDGE_URL
  const bridgeUp = await probeBridge(bridgeUrl)
  if (!bridgeUp) {
    log(`hakka sim attach: warning: no bridge hub reachable at ${bridgeUrl}.`)
    log('  Capture will start but queue with nothing receiving it until one is running.')
    log('  Start one: open the Hakka macOS app, or run `npx hakka-bridge`.')
  }

  log(`hakka sim attach: ${opts.bundleId} on ${device.name} (${device.udid})`)
  log(`  dylib: ${dylib.path} (${dylib.source})`)
  log(`  bridge: ${bridgeUrl}`)

  // Best-effort — an app that was never running has nothing to terminate.
  simctl(['terminate', device.udid, opts.bundleId])

  const launch = simctl(['launch', device.udid, opts.bundleId], {
    SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: dylib.path,
    SIMCTL_CHILD_HAKKA_BRIDGE_URL: bridgeUrl,
  })
  if (launch.status !== 0) {
    log(`hakka sim attach: launch failed: ${launch.stderr.trim() || 'unknown error'}`)
    return 1
  }
  log(`  ${launch.stdout.trim()}`)
  log('  Capture is streaming to the bridge hub, open it (or the macOS app) to watch traffic.')
  log('  Note: WebKit-based apps (Safari, any WKWebView host) will not show page-load traffic,')
  log('  see ADR 0014 for why. In-process URLSession(configuration: .default) calls will.')
  return 0
}

/** `hakka sim attach <bundle-id> [--device ...] [--dylib ...] [--bridge-url ...]` */
export function parseSimAttachArgs(rest: string[]): SimAttachOptions | undefined {
  const valuedFlags = new Set(['--device', '--dylib', '--bridge-url'])
  let bundleId: string | undefined
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg?.startsWith('--')) {
      if (valuedFlags.has(arg)) i++ // skip its value operand too
      continue
    }
    bundleId = arg
    break
  }
  if (!bundleId) return undefined
  const opts: SimAttachOptions = { bundleId }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    const next = (): string | undefined => rest[++i]
    if (arg === '--device') opts.device = next()
    else if (arg === '--dylib') opts.dylibPath = next()
    else if (arg === '--bridge-url') opts.bridgeUrl = next()
  }
  return opts
}

export function simUsage(log: (s: string) => void = console.log): void {
  log('Usage: hakka sim attach <bundle-id> [--device <udid-or-name>] [--dylib <path>] [--bridge-url <url>]')
  log('  Injects Hakka capture into a booted iOS Simulator app via DYLD_INSERT_LIBRARIES.')
  log('  No dylib is shipped with this CLI. Build one with `just build-siminject` from a Hakka checkout.')
  log('  Simulator only. See ADR 0014 (docs/contributing/adr/0014-simulator-injection-capture) for scope and limits.')
}
