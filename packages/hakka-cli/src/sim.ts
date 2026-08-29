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
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

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

function runSimctl(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Resolves a target simulator: `--device <udid-or-name>`, or the sole booted device. */
export function resolveDevice(deviceArg: string | undefined): SimctlDevice | { error: string } {
  const { status, stdout, stderr } = runSimctl(['list', 'devices', '--json'])
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
    return { error: 'no booted simulator found — boot one first (`xcrun simctl boot <name>`), or pass --device' }
  }
  if (booted.length > 1) {
    const names = booted.map((d) => `${d.name} (${d.udid})`).join(', ')
    return { error: `multiple simulators are booted (${names}) — pass --device <udid-or-name>` }
  }
  return booted[0] as SimctlDevice
}

/** Runs `hakka sim attach <bundle-id>`. Never touches a physical device. */
export function runSimAttach(opts: SimAttachOptions, log: (s: string) => void = console.log): number {
  const device = resolveDevice(opts.device)
  if ('error' in device) {
    log(`hakka sim attach: ${device.error}`)
    return 1
  }

  const dylibPath = opts.dylibPath ?? process.env.HAKKA_SIM_INJECT_DYLIB
  if (!dylibPath) {
    log('hakka sim attach: no dylib path given.')
    log('  Pass --dylib <path> or set HAKKA_SIM_INJECT_DYLIB.')
    log('  Build one from ios/SimInject:')
    log('    cd ios/SimInject && xcodebuild build -scheme HakkaSimInject \\')
    log('      -destination generic/platform="iOS Simulator" -sdk iphonesimulator \\')
    log('      SYMROOT="$(pwd)/.build/xcode-sim"')
    log('  This spike does not ship a prebuilt dylib — see the strategy doc for why.')
    return 1
  }
  if (!existsSync(dylibPath)) {
    log(`hakka sim attach: dylib not found at ${dylibPath}`)
    return 1
  }

  const bridgeUrl = opts.bridgeUrl ?? DEFAULT_BRIDGE_URL
  log(`hakka sim attach: ${opts.bundleId} on ${device.name} (${device.udid})`)
  log(`  dylib: ${dylibPath}`)
  log(`  bridge: ${bridgeUrl}`)

  // Best-effort — an app that was never installed has nothing to terminate.
  runSimctl(['terminate', device.udid, opts.bundleId])

  const launch = spawnSync('xcrun', ['simctl', 'launch', device.udid, opts.bundleId], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: dylibPath,
      SIMCTL_CHILD_HAKKA_BRIDGE_URL: bridgeUrl,
    },
  })
  if (launch.status !== 0) {
    log(`hakka sim attach: launch failed: ${(launch.stderr ?? '').trim() || 'unknown error'}`)
    return 1
  }
  log(`  ${launch.stdout.trim()}`)
  log('  Capture is streaming to the bridge hub — open it (or the macOS app) to watch traffic.')
  log('  Note: WebKit-based apps (Safari, any WKWebView host) will not show page-load traffic —')
  log('  see the strategy doc for why. In-process URLSession(configuration: .default) calls will.')
  return 0
}

export function simUsage(log: (s: string) => void = console.log): void {
  log('Usage: hakka sim attach <bundle-id> [--device <udid-or-name>] [--dylib <path>] [--bridge-url <url>]')
  log('  Injects Hakka capture into a booted iOS Simulator app via DYLD_INSERT_LIBRARIES.')
  log('  Simulator only. See ADR 0014 (docs/contributing/adr/0014-simulator-injection-capture) for scope and limits.')
}
