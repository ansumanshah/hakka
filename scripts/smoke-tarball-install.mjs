#!/usr/bin/env node
/**
 * Consumer-side tarball install smoke gate.
 *
 * `npm pack --dry-run` only proves the file list going into each tarball is
 * right — it never actually installs one. This script proves a real consumer
 * can:
 *
 *   1. `npm pack` every publishable package (the dir list is read live from
 *      `packages/`, never hardcoded — each directory there is named for the
 *      package it publishes).
 *   2. Install those tarballs into a fresh project outside this repo (a
 *      `mkdtemp` dir — no bun workspace, no hoisted monorepo `node_modules`,
 *      no repo `bun.lock`), with every inter-package name (`hakka-core`,
 *      `hakka-bridge`, …) forced via `overrides` to resolve to its own
 *      tarball — none of these are published yet, so an un-overridden
 *      semver dependency would 404 against the real registry.
 *   3. Actually `import`/`require` each package's real entry point (+ two
 *      subpath exports) and run a tiny hello-world exercising it, under both
 *      `bun` and the system `node`, and assert on the output.
 *
 * This is the last-mile check `bun run pack:npm:dry-run` doesn't cover: a bad
 * `exports` map, a missing runtime `dependencies` entry (vs. devDependencies),
 * or a package that only ever worked because the monorepo's hoisted
 * `node_modules` papered over a real resolution gap would all pass
 * `npm pack --dry-run` and fail here.
 *
 * Usage:
 *   bun scripts/smoke-tarball-install.mjs
 *   node scripts/smoke-tarball-install.mjs
 *
 * Env:
 *   SMOKE_KEEP_TEMP=1   Skip cleanup of the tarball + consumer temp dirs
 *                       (paths are printed either way) — useful when a run
 *                       fails and you want to poke at the installed tree.
 *
 * Exit code 0 + a per-package/per-runtime PASS/SKIP/FAIL matrix on success;
 * exit code 1 + the same matrix (with the failing cells called out) on any
 * real failure. A SKIP is not a failure — it is only used for the one
 * package (`hakka-react-native`) whose main entry cannot execute outside an
 * actual React Native/Metro/Hermes runtime; see its check for why.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const BUILD_TIMEOUT_MS = 10 * 60_000
const PACK_TIMEOUT_MS = 60_000
const INSTALL_TIMEOUT_MS = 5 * 60_000
const CHECK_TIMEOUT_MS = 30_000

const KEEP_TEMP = process.env.SMOKE_KEEP_TEMP === '1'

function section(msg) {
  process.stdout.write(`\n==> ${msg}\n`)
}

function fail(step, detail) {
  process.stderr.write(`\nFAIL [${step}]: ${detail}\n`)
  process.exit(1)
}

/** Run a command, streaming nothing, failing loudly (with captured output) on a non-zero exit. */
function run(cmd, args, opts = {}) {
  const { step = cmd, ...rest } = opts
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...rest })
  if (res.error) fail(step, `${cmd} ${args.join(' ')}\n${res.error.message}`)
  if (res.status !== 0) {
    fail(
      step,
      `${cmd} ${args.join(' ')} (exit ${res.status})\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
    )
  }
  return res.stdout ?? ''
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * The publishable-package dir list, read live from the filesystem rather than
 * hardcoded, so this smoke gate tracks packages as they are added or removed.
 * The release workflow's version check globs the same directory.
 */
function readPackageDirs() {
  // Every directory under packages/ is named for the package it publishes, so
  // the directory listing IS the package list — no hand-maintained array.
  // `private: true` packages (internal workspaces like hakka-bench) never ship
  // a tarball — `npm publish` refuses them — so they're excluded here; `npm
  // pack --dry-run` alone would happily list them.
  const dir = path.join(repoRoot, 'packages')
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, 'package.json')))
    .filter((e) => JSON.parse(readFileSync(path.join(dir, e.name, 'package.json'), 'utf8')).private !== true)
    .map((e) => e.name)
    .sort()
  if (dirs.length === 0) fail('parse-package-list', `no packages found under ${dir}`)
  return dirs
}

// One check per publishable package, plus subpath-export checks for
// capabilities that live as subpaths of a consolidated package (e.g.
// `hakka-cli:cdp` -> `hakka-cli/cdp`). A subpath check's key is
// `${dir}:${label}`; `dirOf()` below strips the label back off to find the
// owning package dir.
// Every builder is still keyed off (or resolves back to) a package DIR
// (stable across package-name renames, unlike the npm name), and every
// builder takes `names` (dir -> resolved npm package name, read live from
// each tarball's own package.json) so a rename doesn't go stale here either.
// Each generated script prints exactly one `PASS ...`/`SKIP ...` line and
// exits 0 on success, or throws/exits 1 on failure — `runCheck` below parses
// exactly that contract.

const CHECK_BUILDERS = {
  'hakka-core': (n) => `
import assert from 'node:assert/strict'
import { Hakka } from ${JSON.stringify(n['hakka-core'])}

Hakka.start({ mode: 'store' })
Hakka.ingest({ id: 'smoke-core-1', url: 'https://example.com/smoke-core', method: 'GET', status: 200, startTime: Date.now() })
const logs = Hakka.getLogs()
assert.equal(logs.length, 1, \`expected 1 log after ingest(), got \${logs.length}\`)
assert.equal(logs[0].id, 'smoke-core-1')
assert.equal(logs[0].url, 'https://example.com/smoke-core')
console.log('PASS ${n['hakka-core']}: main entry — Hakka.start({mode:"store"}) + ingest() + getLogs()')
`,

  'hakka-bridge': (n) => `
import assert from 'node:assert/strict'
import { startBridgeServer } from ${JSON.stringify(n['hakka-bridge'])}

const server = await startBridgeServer({ port: 0, host: '127.0.0.1', advertise: false })
assert.ok(server.port > 0, 'expected an ephemeral port to be bound')
const ingestResult = server.hub.ingest(JSON.stringify({
  type: 'request',
  payload: { id: 'smoke-bridge-1', url: 'https://example.com/smoke-bridge', method: 'GET', startTime: Date.now() },
}))
assert.equal(ingestResult?.kind, 'request')
assert.equal(server.hub.size, 1, 'expected the ingested frame to land in the hub buffer')
await server.close()
console.log('PASS ${n['hakka-bridge']}: main entry — startBridgeServer() start, hub.ingest(), clean close() (hub start/stop)')
`,

  'hakka-cli:cdp': (n) => `
import assert from 'node:assert/strict'
import { createCdpMapper } from ${JSON.stringify(n['hakka-cli'] + '/cdp')}

const records = []
const mapper = createCdpMapper({ onRequest: (r) => records.push(r), captureBody: false })
await mapper.handleEvent('Network.requestWillBeSent', {
  requestId: 'smoke-cdp-1',
  loaderId: 'loader-1',
  timestamp: 100.0,
  wallTime: 1_700_000_000,
  request: { url: 'https://api.example.com/smoke-cdp', method: 'GET', headers: { 'User-Agent': 'smoke-test' } },
  type: 'XHR',
})
assert.equal(records.length, 1, \`expected 1 mapped record from one synthetic event, got \${records.length}\`)
assert.equal(records[0].url, 'https://api.example.com/smoke-cdp')
assert.equal(records[0].method, 'GET')
console.log('PASS ${n['hakka-cli']}/cdp: subpath export — createCdpMapper().handleEvent() on a synthetic Network.requestWillBeSent event (formerly the standalone hakka-cdp package)')
`,

  'hakka-node': (n) => `
import assert from 'node:assert/strict'
import http from 'node:http'
import { startCapture } from ${JSON.stringify(n['hakka-node'])}

const server = http.createServer((_req, res) => res.end('ok'))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

const captured = []
const capture = startCapture({ bridge: false, sink: (r) => captured.push(r) })
const res = await fetch(\`http://127.0.0.1:\${port}/smoke-node\`)
await res.text()
await new Promise((resolve) => setTimeout(resolve, 150))
capture.stop()
await new Promise((resolve) => server.close(resolve))

const match = captured.find((r) => r.url.includes('/smoke-node'))
assert.ok(match, \`expected a captured request for /smoke-node, got: \${JSON.stringify(captured.map((r) => r.url))}\`)
assert.equal(match.method, 'GET')
console.log('PASS ${n['hakka-node']}: main entry — startCapture() + one real local fetch() captured + stop()')
`,

  'hakka-node:next': (n) => `
import assert from 'node:assert/strict'
import { register } from ${JSON.stringify(n['hakka-node'] + '/next')}

assert.equal(process.env.NEXT_RUNTIME, undefined, 'test env must not set NEXT_RUNTIME for this to be a meaningful edge-safe check')
const result = await register()
assert.equal(result, undefined, 'register() should no-op (return undefined) outside NEXT_RUNTIME==="nodejs"')
console.log('PASS ${n['hakka-node']}/next: subpath export — register() is edge-safe (no-ops outside Next.js\\'s node runtime) (formerly the standalone hakka-next package)')
`,

  // `./metro` is the one hakka-react-native entry point that CAN be checked here.
  // The main entry imports the real `react-native` package at module scope, which
  // node/bun cannot parse (Flow syntax), hence the SKIP rows for it. `metro.js` is
  // plain CommonJS with no react-native import, so a consumer really can require it
  // straight out of the tarball, which is exactly what an app's metro.config.js does.
  // Worth covering precisely because it is load-bearing: without it Metro fails the
  // whole bundle on any optional peer the app did not install.
  'hakka-react-native:metro': (n) => `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { withHakka, OPTIONAL_MODULES } = require(${JSON.stringify(n['hakka-react-native'] + '/metro')})

assert.equal(typeof withHakka, 'function', 'metro.js must export withHakka')
assert.ok(OPTIONAL_MODULES instanceof Set && OPTIONAL_MODULES.size > 0, 'metro.js must export a non-empty OPTIONAL_MODULES set')

// The behaviour that matters: a MISSING optional peer must resolve to Metro's empty
// stub rather than throwing, or the consumer's bundle fails to build.
const optional = [...OPTIONAL_MODULES][0]
const config = withHakka({})
const context = { resolveRequest: () => { throw new Error('Unable to resolve module') } }
assert.deepEqual(config.resolver.resolveRequest(context, optional, 'ios'), { type: 'empty' }, 'a missing optional peer must resolve to { type: "empty" }')
assert.throws(() => config.resolver.resolveRequest(context, './not-optional', 'ios'), 'a missing NON-optional module must still throw')
console.log('PASS ${n['hakka-react-native']}/metro: subpath export — withHakka() stubs a missing optional peer and still throws for a real miss')
`,

  'hakka-core:test': (n) => `
import assert from 'node:assert/strict'
import { assertRequestMade, filterRequests } from ${JSON.stringify(n['hakka-core'] + '/test')}

const logs = [{ id: '1', url: 'https://example.com/smoke-test', method: 'GET', status: 200, startTime: Date.now() }]
const matches = filterRequests(logs, { url: '/smoke-test', method: 'GET' })
assert.equal(matches.length, 1)
assertRequestMade(logs, { url: '/smoke-test' }) // throws HakkaAssertionError on failure
console.log('PASS ${n['hakka-core']}/test: subpath export — filterRequests() + assertRequestMade() against synthetic logs (formerly the standalone "test" package)')
`,

  'hakka-browser:react': (n) => `
// hakka-browser/react's entry transitively imports hakka-browser/elements'
// Solid custom elements; Solid's compiled JSX runs a top-level _$template()
// call at module-eval time (before register()/render() are ever called),
// which needs document/window to exist already. A DOM must be present for
// ANY consumer that imports this package, not just this check — this repo's
// own tests run under happy-dom for the same reason.
import '@happy-dom/global-registrator/register.js'
import assert from 'node:assert/strict'
import * as HakkaReact from ${JSON.stringify(n['hakka-browser'] + '/react')}

for (const name of ['RequestList', 'RequestDetail', 'Waterfall', 'FilterBar', 'Stats', 'JsonTree']) {
  const comp = HakkaReact[name]
  assert.ok(comp, \`expected \${name} to be exported\`)
  assert.equal(typeof comp, 'object', \`expected \${name} to be a React.forwardRef exotic component (typeof === "object")\`)
  assert.equal(typeof comp.render, 'function', \`expected \${name}.render to be a function\`)
}
console.log('PASS ${n['hakka-browser']}/react: subpath export — import-only (with a DOM present — see comment above), all 6 forwardRef component exports resolve (react peer present) (formerly the standalone hakka-react package)')
`,

  'hakka-browser': (n) => `
import assert from 'node:assert/strict'
import hakkaVite, { hakka } from ${JSON.stringify(n['hakka-browser'] + '/vite')}

assert.equal(typeof hakkaVite, 'function', 'default export should be the unplugin vite factory')
assert.equal(hakkaVite, hakka, 'default export and named "hakka" export should be the same factory')
const plugin = hakkaVite()
assert.ok(plugin, 'calling the factory should return a plugin (or array of plugins)')
const first = Array.isArray(plugin) ? plugin[0] : plugin
assert.equal(typeof first.name, 'string', 'expected the returned plugin to have a string "name"')
console.log(\`PASS ${n['hakka-browser']}/vite: subpath export — factory callable, returns a Vite plugin named "\${first.name}"\`)
`,

  'hakka-browser:elements': (n) => `
import '@happy-dom/global-registrator/register.js'
import assert from 'node:assert/strict'
import { register, TAG } from ${JSON.stringify(n['hakka-browser'] + '/elements/request-list')}

assert.equal(TAG, 'hakka-request-list')
assert.equal(typeof customElements, 'object', 'expected happy-dom to provide a global customElements registry')
assert.equal(customElements.get(TAG), undefined, 'tag should not be pre-registered')
register()
const ctor = customElements.get(TAG)
assert.ok(ctor, \`expected customElements.get('\${TAG}') to be defined after register()\`)
const el = document.createElement(TAG)
document.body.appendChild(el)
assert.ok(el instanceof ctor, 'expected the created element to be upgraded to the registered class')
register() // must be idempotent
console.log('PASS ${n['hakka-browser']}/elements/request-list: subpath export — register() defines <hakka-request-list> in happy-dom, idempotent (formerly the standalone hakka-components package)')
`,

  'hakka-rozenite': (n) => `
import '@happy-dom/global-registrator/register.js'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkgJsonPath = require.resolve(${JSON.stringify(n['hakka-rozenite'] + '/package.json')})
const pkgDir = pkgJsonPath.replace(/[\\\\/]package\\.json$/, '')
assert.ok(existsSync(\`\${pkgDir}/dist/rozenite.json\`), 'expected the Rozenite panel manifest in the installed tarball')
assert.ok(existsSync(\`\${pkgDir}/dist/react-native/index.js\`), 'expected the RN entry in the installed tarball')
const rn = await import(${JSON.stringify(n['hakka-rozenite'] + '/react-native')})
assert.equal(typeof rn.useHakkaRozeniteDevTools, 'function', 'expected the RN hook export')
console.log('PASS ${n['hakka-rozenite']}: panel manifest + RN entry present, hook importable')
`,

  'hakka-react-native': (n) => `
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkgJsonPath = require.resolve(${JSON.stringify(n['hakka-react-native'] + '/package.json')})
const pkgDir = pkgJsonPath.replace(/[\\\\/]package\\.json$/, '')
assert.ok(existsSync(\`\${pkgDir}/lib/module/index.js\`), 'expected lib/module/index.js in the installed tarball (structural check)')

// react-native is a required peerDependency, so bun's default peer
// auto-install pulls the real published package in — it isn't simply absent
// from node_modules. Try importing bare "react-native" FIRST, in isolation:
// its own index.js uses Flow syntax that neither node nor bun can parse
// without Metro's Flow-stripping transform, so it fails on its own,
// independent of anything hakka-react-native does. Checked structurally
// (import succeeds or not), not by matching the error text — bun's parse
// error isn't a SyntaxError instance, and node's carries no file path in
// its message or stack.
let reactNativeItselfWorks = true
let reactNativeOwnError = ''
try {
  await import('react-native')
} catch (err) {
  reactNativeItselfWorks = false
  reactNativeOwnError = err instanceof Error ? err.message : String(err)
}

if (!reactNativeItselfWorks) {
  console.log(
    'SKIP ${n['hakka-react-native']}: the real "react-native" package (required peerDependency, auto-installed by bun) ' +
      'cannot itself be imported under plain node/bun — only Metro/Babel can strip its Flow syntax. Since hakka-react-native\\'s ' +
      'main entry (native/nativeAdapter.js) imports react-native at module scope, it can never work here either; this is an ' +
      'environment limitation, not a hakka-react-native bug. Verified structurally instead: tarball extracted, ' +
      'lib/module/index.js present, hakka-core dependency resolves via the same override every other package uses. ' +
      'react-native\\'s own import error: ' + reactNativeOwnError,
  )
} else {
  // react-native imported fine in this environment (e.g. a future node/bun
  // that can strip Flow) — this must actually work now.
  await import(${JSON.stringify(n['hakka-react-native'])})
  console.log('PASS ${n['hakka-react-native']}: main entry imported successfully (react-native is importable in this env)')
}
`,

  'hakka-cli': (n) => `
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkgJsonPath = require.resolve(${JSON.stringify(n['hakka-cli'] + '/package.json')})
const binPath = pkgJsonPath.replace(/package\\.json$/, 'dist/cli.mjs')
const stdout = execFileSync(process.execPath, [binPath, 'init', '--no-install'], { encoding: 'utf8', timeout: 15_000 })
assert.match(stdout, /Hakka/i, 'expected the banner in hakka init output')
assert.match(stdout, /Install:/, 'expected the (skipped) install instructions to be printed')
console.log('PASS ${n['hakka-cli']} (bin): "hakka init --no-install" runs end-to-end (no framework detected -> drop-in web setup)')
`,

  'hakka-cli:mcp': (n) => `
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkgJsonPath = require.resolve(${JSON.stringify(n['hakka-cli'] + '/package.json')})
const binPath = pkgJsonPath.replace(/package\\.json$/, 'dist/cli.mjs')

const child = spawn(process.execPath, [binPath, 'mcp'], {
  stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, HAKKA_BRIDGE_URL: 'ws://127.0.0.1:1', HAKKA_MCP_MAX_REQUESTS: '10' },
})

let stderr = ''
child.stderr.on('data', (c) => { stderr += c.toString() })

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(\`timed out waiting for "ready"; stderr so far:\\n\${stderr}\`)), 10_000)
  const check = () => {
    if (/\\[hakka\\] ready/.test(stderr)) {
      clearTimeout(timer)
      resolve()
    }
  }
  child.stderr.on('data', check)
  child.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(\`server exited early (code \${code}) before printing "ready"; stderr:\\n\${stderr}\`))
  })
  check()
})

child.kill('SIGTERM')
const exitCode = await new Promise((resolve) => child.on('exit', (code) => resolve(code)))
assert.ok(stderr.includes('shutting down'), 'expected a graceful-shutdown log line after SIGTERM')
console.log(\`PASS ${n['hakka-cli']} mcp (bin): "hakka mcp" subcommand starts, prints ready, shuts down cleanly on SIGTERM (exit \${exitCode}) (formerly the standalone hakka-mcp package's own bin)\`)
`,
}

/**
 * A CHECK_BUILDERS key is either a bare package dir (`'core'`) or a
 * `${dir}:${label}` subpath check (`'hakka-core:test'`) — this strips the label
 * back off so every place that needs the owning package dir (for `names`
 * lookups, `dirs` membership, and the tarball/consumer install) has one
 * definition of how to get there.
 */
function dirOf(key) {
  const i = key.indexOf(':')
  return i === -1 ? key : key.slice(0, i)
}

/** Execution order — bin/happy-dom checks that mutate globals or spawn children are scheduled where they can't taint earlier in-process network checks. */
const CHECK_ORDER = [
  'hakka-core',
  'hakka-core:test',
  'hakka-bridge',
  'hakka-node',
  'hakka-node:next',
  'hakka-cli:cdp',
  'hakka-react-native',
  'hakka-react-native:metro',
  'hakka-cli',
  'hakka-cli:mcp',
  'hakka-browser',
  'hakka-browser:elements',
  'hakka-browser:react',
  'hakka-rozenite',
]

function runCheck(runtimeBin, filePath, cwd) {
  const start = Date.now()
  const res = spawnSync(runtimeBin, [filePath], { cwd, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS })
  const durationMs = Date.now() - start
  const stdout = (res.stdout ?? '').trim()
  const stderr = (res.stderr ?? '').trim()

  if (res.error) return { status: 'fail', message: `spawn error: ${res.error.message}`, durationMs }
  if (res.signal)
    return {
      status: 'fail',
      message: `killed by signal ${res.signal} (timeout after ${CHECK_TIMEOUT_MS}ms)\n${stderr}`,
      durationMs,
    }

  const line = stdout.split('\n').find((l) => l.startsWith('PASS ') || l.startsWith('SKIP '))
  if (res.status === 0 && line) {
    return { status: line.startsWith('SKIP ') ? 'skip' : 'pass', message: line, durationMs }
  }
  return { status: 'fail', message: (stderr || stdout || `exited with code ${res.status}`).trim(), durationMs }
}

// Tracked here (not just locals inside `main`) so the `process.on('exit', ...)`
// handler below can clean up no matter WHERE execution stops — including an
// early `fail()` (which calls `process.exit(1)` directly, skipping over any
// try/finally further down the call stack).
let tarballDirToClean
let consumerDirToClean
process.on('exit', () => {
  if (KEEP_TEMP) return
  for (const dir of [tarballDirToClean, consumerDirToClean]) {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

async function main() {
  const dirs = readPackageDirs()
  section(`Package list (from packages/): ${dirs.join(', ')}`)

  section('Building all publishable packages (bun run build)')
  run('bun', ['run', 'build'], { cwd: repoRoot, step: 'build', timeout: BUILD_TIMEOUT_MS })

  const tarballDir = mkdtempSync(path.join(tmpdir(), 'hakka-smoke-tarballs-'))
  tarballDirToClean = tarballDir
  section(`Packing ${dirs.length} tarballs into ${tarballDir}`)
  const names = {} // dir -> resolved npm package name (read live, not hardcoded)
  const tarballs = {} // package name -> absolute tarball path
  for (const dir of dirs) {
    const pkgDir = path.join(repoRoot, 'packages', dir)
    const pkgJson = readJson(path.join(pkgDir, 'package.json'))
    names[dir] = pkgJson.name
    const out = run('npm', ['pack', '--json', `--pack-destination=${tarballDir}`], {
      cwd: pkgDir,
      step: `pack:${pkgJson.name}`,
      timeout: PACK_TIMEOUT_MS,
    })
    // `npm pack --json`'s shape changed across npm major versions: older npm
    // (<=10) prints an array of pack results, newer npm (>=11, verified on
    // 12.0.2) prints an object keyed by package name instead. Handle both so
    // this doesn't silently break again on the next npm bump.
    const packed = JSON.parse(out)
    const { filename } = Array.isArray(packed) ? packed[0] : Object.values(packed)[0]
    tarballs[pkgJson.name] = path.join(tarballDir, filename)
    process.stdout.write(`    packed ${pkgJson.name}@${pkgJson.version} -> ${filename}\n`)
  }

  const consumerDir = mkdtempSync(path.join(tmpdir(), 'hakka-smoke-consumer-'))
  consumerDirToClean = consumerDir
  section(`Fresh consumer project at ${consumerDir}`)

  const overrides = Object.fromEntries(Object.entries(tarballs).map(([name, tgz]) => [name, `file:${tgz}`]))
  const consumerPkg = {
    name: 'hakka-tarball-smoke-consumer',
    private: true,
    version: '0.0.0',
    type: 'module',
    // Direct deps: every tarball (so bun installs + hoists all 7), plus the
    // few genuinely-third-party packages the check scripts need (react/
    // react-dom for hakka-browser/react's peer requirement, happy-dom for the
    // hakka-browser/elements custom-element check).
    dependencies: {
      ...overrides,
      react: '19.2.3',
      'react-dom': '19.2.3',
      'happy-dom': '^20.10.6',
      '@happy-dom/global-registrator': '^20.10.6',
    },
    // Every inter-package name forced to its own tarball — none of these are
    // published yet, so an un-overridden internal "hakka-core": "0.1.0"
    // dependency (e.g. inside hakka-browser's own package.json) would
    // otherwise try the real npm registry and fail (or worse, silently
    // resolve an unrelated same-numbered version if one ever gets published).
    overrides,
  }
  writeFileSync(path.join(consumerDir, 'package.json'), `${JSON.stringify(consumerPkg, null, 2)}\n`)

  section('bun install (fresh — no lockfile, no workspace, no monorepo node_modules)')
  run('bun', ['install'], { cwd: consumerDir, step: 'bun install', timeout: INSTALL_TIMEOUT_MS })

  // A package can show up in the live `pack:npm:dry-run` list with no check
  // builder registered here yet (bare-dir or subpath). That must not
  // silently drop coverage, but it also must not abort before printing a
  // matrix for every check this script DOES cover — so it's tracked and
  // surfaced as its own "NO CHECK" row (still fails the gate overall)
  // instead of a hard `fail()` here.
  const covered = CHECK_ORDER.filter((key) => dirs.includes(dirOf(key)))
  const builderDirs = new Set(Object.keys(CHECK_BUILDERS).map(dirOf))
  const uncovered = dirs.filter((dir) => !builderDirs.has(dir))
  if (uncovered.length > 0) {
    process.stderr.write(
      `\nWARNING: pack:npm:dry-run lists package(s) with no smoke check wired up yet: ${uncovered.join(', ')}\n` +
        `(this fails the gate — see the matrix below — but the rest of the packages still run)\n`,
    )
  }

  const checksDir = path.join(consumerDir, 'checks')
  mkdirSync(checksDir)
  const checkFiles = {} // check key -> absolute path
  covered.forEach((key, i) => {
    const file = path.join(checksDir, `${String(i + 1).padStart(2, '0')}-${key.replace(':', '-')}.mjs`)
    writeFileSync(file, CHECK_BUILDERS[key](names).trimStart())
    checkFiles[key] = file
  })

  const runtimes = [
    { label: 'bun', bin: 'bun' },
    { label: 'node', bin: 'node' },
  ]
  for (const rt of runtimes) {
    const v = run(rt.bin, ['--version'], { step: `${rt.label} --version` }).trim()
    process.stdout.write(`    ${rt.label}: ${v}\n`)
  }

  /** @type {Record<string, Record<string, {status:string,message:string,durationMs:number}>>} */
  const matrix = {}
  let anyFail = uncovered.length > 0
  for (const key of covered) {
    matrix[key] = {}
    for (const rt of runtimes) {
      section(`[${rt.label}] ${names[dirOf(key)]} (${key})`)
      const result = runCheck(rt.bin, checkFiles[key], consumerDir)
      matrix[key][rt.label] = result
      process.stdout.write(`${result.message}\n`)
      if (result.status === 'fail') anyFail = true
    }
  }

  section('Result matrix (package[:subpath check] | bun | node)')
  const glyph = (s) => (s === 'pass' ? 'PASS' : s === 'skip' ? 'SKIP' : 'FAIL')
  // A subpath check's row label is "<npm name> (<label>)" so a failure
  // identifies which surface broke even when several checks share a dir
  // (e.g. hakka-browser's /vite, /elements/request-list, and /react checks).
  const label = (key) => {
    const i = key.indexOf(':')
    return i === -1 ? names[key] : `${names[dirOf(key)]} (${key.slice(i + 1)})`
  }
  const rows = covered.map(
    (key) => `  ${label(key).padEnd(32)} bun=${glyph(matrix[key].bun.status)}  node=${glyph(matrix[key].node.status)}`,
  )
  for (const dir of uncovered) {
    rows.push(`  ${dir.padEnd(32)} bun=NO_CHECK  node=NO_CHECK  <- add a CHECK_BUILDERS['${dir}'] entry`)
  }
  process.stdout.write(`${rows.join('\n')}\n`)

  // ── 7: cleanup — actually performed by the `process.on('exit', ...)` handler
  // above, so it still runs even if something further up called `fail()` and
  // exited early. This just reports what's about to happen.
  if (KEEP_TEMP) {
    process.stdout.write(`\nSMOKE_KEEP_TEMP=1 — leaving temp dirs in place:\n  ${tarballDir}\n  ${consumerDir}\n`)
  } else {
    process.stdout.write(`\nCleaning up temp dirs:\n  ${tarballDir}\n  ${consumerDir}\n`)
  }

  if (anyFail) {
    process.stderr.write('\nsmoke-tarball-install: FAILED (see matrix above)\n')
    process.exit(1)
  }
  process.stdout.write('\nsmoke-tarball-install: PASS\n')
}

main().catch((err) => {
  fail('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err))
})
