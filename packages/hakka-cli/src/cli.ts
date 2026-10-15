#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
// `hakka init`: safe + idempotent — only creates files that don't exist, never edits/clobbers.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

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

/** What `install` did: ran it successfully, only printed it (--no-install), or ran it and it failed. */
type InstallOutcome = 'installed' | 'skipped' | 'failed'

/** Install a set of package specs (or just print the command with --no-install). */
function install(specs: string[], opts: { dev?: boolean; skip: boolean }): InstallOutcome {
  const pm = detectPackageManager()
  const cmdStr = installCommand(pm, specs, opts.dev)
  if (opts.skip) {
    log(`Install:`)
    log(`  ${c.cyan(cmdStr)}\n`)
    return 'skipped'
  }
  log(`Installing with ${c.bold(pm)}…`)
  if (!runInstall(pm, specs, opts.dev)) {
    process.stderr.write(`hakka init: the install command failed: ${cmdStr}\nFix the error above, then run it again.\n`)
    return 'failed'
  }
  log(`  ${c.green('•')} installed ${specs.join(', ')}\n`)
  return 'installed'
}

/** Only claims capture is live when the packages actually installed. */
function nextSteps(outcome: InstallOutcome, ...lines: string[]): void {
  log(outcome === 'installed' ? `${c.green("You're capturing.")} Next steps:` : `Next steps, once installed:`)
  for (const line of lines) log(`  ${c.dim('→')} ${line}`)
}

function appDir(): string {
  return existsSync(join(cwd, 'src')) ? 'src' : '.'
}

function initNext(skipInstall: boolean): number {
  log(`Detected ${c.bold('Next.js')}.\n`)
  const outcome = install(['hakka-node', 'hakka-browser'], { skip: skipInstall })
  if (outcome === 'failed') return 1
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
    outcome,
    `run ${c.cyan('next dev')}`,
    `open the overlay in your browser — server + client requests show up in one UI`,
  )
  return 0
}

function initVite(skipInstall: boolean): number {
  log(`Detected ${c.bold('Vite')}.\n`)
  const outcome = install(['hakka-browser'], { skip: skipInstall })
  if (outcome === 'failed') return 1
  log(`Add the plugin to your ${c.cyan('vite.config')} (overlay auto-injects in dev):\n`)
  log(c.dim(`  import hakka from 'hakka-browser/vite'\n  export default defineConfig({ plugins: [hakka()] })\n`))
  nextSteps(outcome, `run ${c.cyan('vite')}`, `open the overlay in your browser`)
  return 0
}

function initReactNative(expo: boolean, skipInstall: boolean): number {
  log(`Detected ${c.bold(expo ? 'Expo' : 'React Native')}.\n`)
  const outcome = install(['hakka-react-native'], { skip: skipInstall })
  if (outcome === 'failed') return 1
  log(`Render the monitor near your app root (dev only):\n`)
  log(c.dim(`  import { Hakka } from 'hakka-react-native'\n  Hakka.start()\n  await Hakka.show({ as: 'bubble' })\n`))
  if (expo) {
    log(`Expo config plugin (native capture wired at prebuild):\n`)
    log(c.dim(`  // app.json / app.config.js\n  { "plugins": ["hakka-react-native"] }\n`))
    log(`Then run ${c.cyan('npx expo prebuild')} (or ${c.cyan('expo run:ios')} / ${c.cyan('expo run:android')}).\n`)
  }
  nextSteps(
    outcome,
    expo ? `rebuild the dev client (${c.cyan('expo run:ios')} / ${c.cyan('expo run:android')})` : `rebuild the app`,
    `shake the device or tap the bubble to open the inspector`,
  )
  return 0
}

function initWeb(skipInstall: boolean): number {
  log(`No framework detected — using the ${c.bold('drop-in')} setup.\n`)
  const outcome = install(['hakka-browser'], { skip: skipInstall })
  if (outcome === 'failed') return 1
  log(`Then:`)
  log(c.dim(`  import { start } from 'hakka-browser'\n  start()\n`))
  log(`…or a single script tag (no build step, skip the install above):`)
  log(c.dim(`  <script async src="https://unpkg.com/hakka-browser/dist/hakka-browser.global.js"></script>`))
  log(c.dim(`  <script>addEventListener('load', () => Hakka.start())</script>\n`))
  nextSteps(outcome, `reload the page`, `open the overlay`)
  return 0
}

function init(args: string[]): number {
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

function packageVersion(): string {
  const pkg = createRequire(import.meta.url)('../package.json') as { version: string }
  return pkg.version
}

async function usage(): Promise<void> {
  log(`Usage: ${c.cyan('hakka init')}`)
  log('       hakka run <collection-directory|request.hakka> [--json] [--env NAME=value]')
  log('       hakka team <serve|push|pull|secret> [options]')
  log((await import('./proxyCommand.js')).proxyUsage())
  diagnoseUsage()
  assertUsage()
  ciBaselineUsage()
  mcpUsage()
  cdpUsage()
  simUsage()
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv
  if (cmd !== undefined && cmd !== 'help' && cmd !== 'proxy' && (rest.includes('--help') || rest.includes('-h'))) {
    await usage()
    return
  }
  switch (cmd ?? 'init') {
    case '--version':
    case '-v':
      log(packageVersion())
      break
    case '--help':
    case '-h':
    case 'help':
      await usage()
      break
    case 'init':
      process.exitCode = init(rest)
      break
    case 'run': {
      const { runCommand } = await import('./runCommand.js')
      process.exitCode = await runCommand(rest)
      break
    }
    case 'team': {
      const { teamCommand } = await import('./teamCommand.js')
      process.exitCode = await teamCommand(rest)
      break
    }
    case 'proxy': {
      const { runProxyCommand } = await import('./proxyCommand.js')
      await runProxyCommand(rest)
      break
    }
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
      await usage()
      process.exitCode = 1
  }
}

// npm bins are symlinks, so an argv[1] === import.meta.url guard would make the
// installed command a silent no-op. Nothing imports this module, so always run.
/**
 * One line, no stack trace. Every error that reaches here is one the user can
 * act on (a port in use, Chrome not running, a bad flag), so the message is the
 * useful part. Set HAKKA_DEBUG=1 to see the stack.
 */
function describeFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  if (process.env.HAKKA_DEBUG) return err.stack ?? err.message
  if ('code' in err && err.code === 'EADDRINUSE') {
    // Node puts the port on the error; other runtimes only mention it in the message.
    const port = 'port' in err && typeof err.port === 'number' ? err.port : /(\d{2,5})\D*$/.exec(err.message)?.[1]
    return `${port === undefined ? 'That port' : `Port ${port}`} is already in use. Stop whatever is using it or pick another with --port <number>.`
  }
  return err.message
}

main().catch((err: unknown) => {
  process.stderr.write(`hakka: ${describeFailure(err)}\n`)
  process.exit(1)
})
