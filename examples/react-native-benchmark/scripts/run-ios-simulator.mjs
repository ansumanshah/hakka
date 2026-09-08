import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    device: { type: 'string' },
    apps: { type: 'string' },
    output: { type: 'string' },
    rounds: { type: 'string', default: '5' },
  },
})
if (!values.device || !values.apps || !values.output) {
  throw new Error('Required: --device <simulator UUID> --apps <DerivedData root> --output <results directory>')
}
const rounds = Number(values.rounds)
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer')

const variants = ['baseline', 'hakka', 'pulse', 'wormholy']
const output = resolve(values.output)
const apps = new Map()
for (const variant of variants) {
  const app = resolve(values.apps, `final-ios-${variant}/Build/Products/Release-iphonesimulator/HakkaRNExample.app`)
  const bundleId = `com.noodleapps.hakka.rn.benchmark.${variant}`
  if (!existsSync(app)) throw new Error(`Missing Release application: ${app}`)
  const actualId = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', `${app}/Info.plist`], {
    encoding: 'utf8',
  }).trim()
  if (actualId !== bundleId) throw new Error(`Bundle identifier mismatch: ${actualId}, expected ${bundleId}`)
  apps.set(variant, { app, bundleId })
}
mkdirSync(output, { recursive: true })

for (let round = 0; round < rounds; round += 1) {
  const order = variants.map((_, index) => variants[(index + round) % variants.length])
  for (const variant of order) {
    const destination = resolve(output, `${String(round + 1).padStart(2, '0')}-${variant}.json`)
    if (existsSync(destination)) throw new Error(`Refusing to overwrite a result: ${destination}`)
    const { app, bundleId } = apps.get(variant)
    // Each application starts with an empty native store and a fresh process.
    let installed = true
    try {
      simctl('get_app_container', values.device, bundleId, 'data')
    } catch (error) {
      if (error.status !== 2 || !String(error.stderr).includes('NSPOSIXErrorDomain, code=2')) throw error
      installed = false
    }
    if (installed) simctl('uninstall', values.device, bundleId)
    simctl('install', values.device, app)
    simctl('launch', values.device, bundleId, '--hakka-benchmark-autorun')
    const container = simctl('get_app_container', values.device, bundleId, 'data').trim()
    const resultPath = resolve(container, 'Documents/hakka-rn-benchmark-result.json')
    const deadline = Date.now() + 60_000
    while (!existsSync(resultPath) && Date.now() < deadline) {
      // Poll this run before starting another application on the shared simulator.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((done) => setTimeout(done, 250))
    }
    if (!existsSync(resultPath)) throw new Error(`Timed out waiting for ${variant} result`)
    const result = JSON.parse(readFileSync(resultPath, 'utf8'))
    simctl('terminate', values.device, bundleId)
    writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`)
    if (result.error) throw new Error(`${variant}: ${result.error}; evidence saved to ${destination}`)
    if (result.variant !== variant || result.completedCount !== 100 || result.samples?.length !== 100) {
      throw new Error(`Invalid workload result: ${destination}`)
    }
    if (result.environment?.debugBuild !== false) throw new Error(`Expected a Release build: ${destination}`)
    if (variant !== 'baseline' && variant !== 'wormholy' && result.capturedCount !== 100) {
      throw new Error(`Capture count mismatch: ${destination}`)
    }
    console.log(JSON.stringify({ round: round + 1, variant, ...result.summary, result: destination }))
  }
}

function simctl(...args) {
  return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
