#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
// `hakka init`: safe + idempotent — only creates files that don't exist, never edits/clobbers.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseAssertArgs, assertCommand } from './assert'
import type { CdpAttachOptions } from './cdp/index'
import { ciBaselineCommand } from './ciBaseline'
import { detectFramework, readPkg } from './detectFramework'
import { diagnose } from './diagnose'
import { detectPackageManager, installCommand, type PackageManager } from './packageManager'
import { parseSimAttachArgs, runSimAttach, simUsage } from './sim'

const cwd = process.cwd()

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
}
const log = (s = '') => process.stdout.write(s + '\n')

function writeIfAbsent(relPath: string, content: string): 'created' | 'exists' {
  const abs = join(cwd, relPath)
  if (existsSync(abs)) return 'exists'
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  return 'created'
}

function report(relPath: string, action: 'created' | 'exists'): void {
  if (action === 'created') log(`  ${c.green('•')} created ${c.cyan(relPath)}`)
  else log(`  ${c.yellow('•')} ${c.cyan(relPath)} already exists — left untouched`)
}

/** Run the install command for real. Returns true on success (exit code 0). */
function runInstall(pm: PackageManager, specs: string[], dev = false): boolean {
  const cmdStr = installCommand(pm, specs, dev)
  log(`  ${c.dim('$')} ${c.cyan(cmdStr)}`)
  const [bin, ...args] = cmdStr.split(' ')
  const result = spawnSync(bin as string, args, { cwd, stdio: 'inherit' })
  return result.status === 0
}

/** Install a set of package specs (or just print the command with --no-install / on failure). */
function install(specs: string[], opts: { dev?: boolean; skip: boolean }): void {
  const pm = detectPackageManager()
  const cmdStr = installCommand(pm, specs, opts.dev)
  if (opts.skip) {
    log(`Install:`)
    log(`  ${c.cyan(cmdStr)}\n`)
    return
  }
  log(`Installing with ${c.bold(pm)}…`)
  const ok = runInstall(pm, specs, opts.dev)
  if (!ok) {
    log(`  ${c.yellow('•')} auto-install failed — run this yourself:`)
    log(`  ${c.cyan(cmdStr)}\n`)
  } else {
    log(`  ${c.green('•')} installed ${specs.join(', ')}\n`)
  }
}

function nextSteps(...lines: string[]): void {
  log(`${c.green("You're capturing.")} Next steps:`)
  for (const line of lines) log(`  ${c.dim('→')} ${line}`)
}

function appDir(): string {
  return existsSync(join(cwd, 'src')) ? 'src' : '.'
}

function initNext(skipInstall: boolean): void {
  log(`Detected ${c.bold('Next.js')}.\n`)
  install(['hakka-node', 'hakka-browser'], { skip: skipInstall })
  const dir = appDir()
  log(`Wiring (two one-line files):`)
  const a = writeIfAbsent(
    join(dir, 'instrumentation.ts'),
    `// Hakka — server-side capture + embedded bridge (dev only).\nexport { register } from 'hakka-node/next'\n`,
  )
  report(join(dir, 'instrumentation.ts'), a)
  const b = writeIfAbsent(
    join(dir, 'instrumentation-client.ts'),
    `// Hakka — overlay + connect on the client (Next 15.3+, dev only).\nimport 'hakka-node/next/client'\n`,
  )
  report(join(dir, 'instrumentation-client.ts'), b)
  log()
  nextSteps(
    `run ${c.cyan('next dev')}`,
    `open the overlay in your browser — server + client requests show up in one UI`,
  )
}

function initVite(skipInstall: boolean): void {
  log(`Detected ${c.bold('Vite')}.\n`)
  install(['hakka-browser'], { skip: skipInstall })
  log(`Add the plugin to your ${c.cyan('vite.config')} (overlay auto-injects in dev):\n`)
  log(c.dim(`  import hakka from 'hakka-browser/vite'\n  export default defineConfig({ plugins: [hakka()] })\n`))
  nextSteps(`run ${c.cyan('vite')}`, `open the overlay in your browser`)
}

function initReactNative(expo: boolean, skipInstall: boolean): void {
  log(`Detected ${c.bold(expo ? 'Expo' : 'React Native')}.\n`)
  install(['hakka-react-native'], { skip: skipInstall })
  log(`Render the monitor near your app root (dev only):\n`)
  log(
    c.dim(
      `  import { Hakka } from 'hakka-react-native'\n  Hakka.start({ mode: 'native' })\n  await Hakka.show({ as: 'bubble' })\n`,
    ),
  )
  if (expo) {
    log(`Expo config plugin (native capture wired at prebuild):\n`)
    log(c.dim(`  // app.json / app.config.js\n  { "plugins": ["hakka-react-native"] }\n`))
    log(`Then run ${c.cyan('npx expo prebuild')} (or ${c.cyan('expo run:ios')} / ${c.cyan('expo run:android')}).\n`)
  }
  nextSteps(
    expo ? `rebuild the dev client (${c.cyan('expo run:ios')} / ${c.cyan('expo run:android')})` : `rebuild the app`,
    `shake the device or tap the bubble to open the inspector`,
  )
}

function initWeb(skipInstall: boolean): void {
  log(`No framework detected — using the ${c.bold('drop-in')} setup.\n`)
  install(['hakka-browser'], { skip: skipInstall })
  log(`Then:`)
  log(c.dim(`  import { start } from 'hakka-browser'\n  start()\n`))
  log(`…or a single script tag (no build step, skip the install above):`)
  log(c.dim(`  <script async src="https://unpkg.com/hakka-browser/dist/hakka-browser.global.js"></script>`))
  log(c.dim(`  <script>addEventListener('load', () => Hakka.start())</script>\n`))
  nextSteps(`reload the page`, `open the overlay`)
}

function init(args: string[]): void {
  const skipInstall = args.includes('--no-install') || args.includes('--dry-run')
  log(`\n${c.bold('Hakka')} — setting up the network inspector\n`)
  const pkg = readPkg()
  switch (detectFramework(pkg)) {
    case 'next':
      return initNext(skipInstall)
    case 'vite':
      return initVite(skipInstall)
    case 'expo':
      return initReactNative(true, skipInstall)
    case 'react-native':
      return initReactNative(false, skipInstall)
    default:
      return initWeb(skipInstall)
  }
}

function diagnoseUsage(): void {
  log(`Usage: ${c.cyan('hakka diagnose <file.hakka|file.har>')} ${c.dim('[--slow-ms <n>]')}`)
}

function assertUsage(): void {
  log(
    `Usage: ${c.cyan('hakka assert <file.hakka|file.har>')} ${c.dim(
      '[--max-failures <n>] [--max-duration-ms <n>] [--fail-on-secrets] [--budget-p95-ms <n>] [--json]',
    )}`,
  )
}

function ciBaselineUsage(): void {
  log(`Usage: ${c.cyan('hakka ci-baseline record <capture.hakka> <baseline.txt>')}`)
  log(
    `       ${c.cyan('hakka ci-baseline check <capture.hakka> <baseline.txt>')} ${c.dim('[--allow-host <host>] [--json]')}`,
  )
}

function mcpUsage(): void {
  log(`Usage: ${c.cyan('hakka mcp')} ${c.dim('[--url ws://host:port] [--port <n>] [--serve|--no-serve]')}`)
}

function cdpUsage(): void {
  log(
    `Usage: ${c.cyan('hakka cdp')} ${c.dim(
      '[--url ws://.../devtools/page/<id>] [--port <n>] [--target <substr>] [--bridge-url ws://host:port]',
    )}`,
  )
}

// mcp/cdp are dynamically imported here so a plain `hakka init` never loads @modelcontextprotocol/sdk, zod, or ws.
/** `hakka mcp [--url ws://host:port] [--port <n>] [--no-serve]` — see ./mcp/server.ts for the full flag/env contract. */
async function runMcp(): Promise<void> {
  const { main: startMcpServer } = await import('./mcp/index.js')
  await startMcpServer()
}

function parseCdpArgs(rest: string[]): CdpAttachOptions {
  const opts: CdpAttachOptions = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    const next = (): string | undefined => rest[++i]
    if (arg === '--url') opts.url = next()
    else if (arg === '--port') {
      const v = next()
      if (v) opts.port = Number(v)
    } else if (arg === '--target') opts.target = next()
    else if (arg === '--bridge-url') opts.bridgeUrl = next()
    else if (arg === '--no-body') opts.captureBody = false
    else if (arg === '--max-body-size') {
      const v = next()
      if (v) opts.maxBodySize = Number(v)
    }
  }
  return opts
}

async function runCdp(rest: string[]): Promise<void> {
  const { runCdpAttach } = await import('./cdp/index.js')
  await runCdpAttach(parseCdpArgs(rest))
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv
  switch (cmd ?? 'init') {
    case 'init':
      init(rest)
      break
    case 'diagnose': {
      const slowIdx = rest.indexOf('--slow-ms')
      const slowMs = slowIdx !== -1 && rest[slowIdx + 1] ? Number(rest[slowIdx + 1]) : undefined
      let filePath: string | undefined
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]
        if (a?.startsWith('--')) {
          if (a === '--slow-ms') i++ // skip its value operand too
          continue
        }
        filePath = a
        break
      }
      if (filePath === undefined) {
        diagnoseUsage()
        process.exitCode = 1
        break
      }
      diagnose(filePath, slowMs !== undefined && !Number.isNaN(slowMs) ? { slowMs } : {})
      break
    }
    case 'assert': {
      const { filePath, options } = parseAssertArgs(rest)
      if (filePath === undefined && !options.json) {
        assertUsage()
        process.exitCode = 2
        break
      }
      assertCommand(filePath, options)
      break
    }
    case 'ci-baseline':
      ciBaselineCommand(rest)
      break
    case 'mcp':
      // stdout is the JSON-RPC channel once this starts — nothing above this branch may print after it runs.
      await runMcp()
      break
    case 'cdp':
      await runCdp(rest)
      break
    case 'sim': {
      const [sub, ...simRest] = rest
      if (sub !== 'attach') {
        simUsage()
        process.exitCode = 1
        break
      }
      const opts = parseSimAttachArgs(simRest)
      if (!opts) {
        simUsage()
        process.exitCode = 1
        break
      }
      process.exitCode = await runSimAttach(opts)
      break
    }
    default:
      log(`Unknown command: ${cmd}\n`)
      log(`Usage: ${c.cyan('hakka init')}`)
      diagnoseUsage()
      assertUsage()
      ciBaselineUsage()
      mcpUsage()
      cdpUsage()
      simUsage()
      process.exitCode = 1
  }
}

// Run only when invoked as a CLI — not when imported by tests.
const invokedDirectly = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  main().catch((err: unknown) => {
    process.stderr.write(`hakka: fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    process.exit(1)
  })
}
