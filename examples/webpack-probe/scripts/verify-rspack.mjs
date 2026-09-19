import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const port = 5292
const baseUrl = `http://127.0.0.1:${port}`
const browserPackage = fileURLToPath(new URL('../../../packages/hakka-browser/package.json', import.meta.url))
const { chromium } = createRequire(browserPackage)('@playwright/test')
const nodeOptions = [process.env.NODE_OPTIONS, '--preserve-symlinks'].filter(Boolean).join(' ')
const rspackCli = resolve('node_modules/@rspack/cli/bin/rspack.js')
const devServer = spawn(
  process.execPath,
  [rspackCli, 'dev', '--config', 'rspack.config.js', '--host', '127.0.0.1', '--port', port, '--no-open'],
  {
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let output = ''
devServer.stdout.on('data', (chunk) => (output += chunk))
devServer.stderr.on('data', (chunk) => (output += chunk))

try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) break
    } catch {}
    await delay(200)
    if (attempt === 49) throw new Error(`Rspack dev server did not start:\n${output}`)
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const consoleIssues = []
    const pageErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') consoleIssues.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => {
      const inspector = document.querySelector('hakka-inspector')
      return !!inspector?.shadowRoot?.querySelector('.hakka-panel.open')
    })
    await page.waitForFunction(() =>
      [...(document.querySelector('hakka-inspector')?.shadowRoot?.querySelectorAll('.hakka-row') ?? [])].some((row) =>
        row.textContent?.includes('rspack-probe.txt'),
      ),
    )
    if (consoleIssues.length || pageErrors.length) {
      throw new Error(`Browser errors: ${JSON.stringify({ consoleIssues, pageErrors })}`)
    }
  } finally {
    await browser.close()
  }
} finally {
  if (devServer.exitCode === null) {
    const exited = new Promise((resolveExit) => devServer.once('exit', resolveExit))
    devServer.kill('SIGTERM')
    await Promise.race([exited, delay(2_000)])
    if (devServer.exitCode === null) {
      devServer.kill('SIGKILL')
      await exited
    }
  }
}

const production = spawn(
  process.execPath,
  [rspackCli, 'build', '--config', 'rspack.config.js', '--mode', 'production'],
  {
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    stdio: 'inherit',
  },
)
if ((await new Promise((resolveExit) => production.once('exit', resolveExit))) !== 0) {
  throw new Error('Rspack production build failed.')
}

const dist = resolve('dist')
const html = await readFile(resolve(dist, 'index.html'), 'utf8')
if (/data-hakka|Hakka\.start|hakka-inject/.test(html)) throw new Error('Production HTML includes the Hakka runtime.')
await access(resolve(dist, 'bundle.js'))
try {
  await access(resolve(dist, 'hakka-inject.js'))
  throw new Error('Production output retained hakka-inject.js after output.clean.')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

console.log('Rspack dev runtime captured the probe fetch and opened the inspector; production output stripped Hakka.')
