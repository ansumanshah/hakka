import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENTRY = join(import.meta.dir, '..', 'index.ts')
// The bug is about Node's event loop, and bun's own `ws` client cannot be
// unref'd, so the child runs under real `node` against a bundle of the source.
const NODE = Bun.which('node')

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

interface ChildResult {
  exited: boolean
  stdout: string
}

/** Runs `source` as a script and reports whether it exited on its own within `ms`. */
async function runScript(source: string, ms: number): Promise<ChildResult> {
  const dir = mkdtempSync(join(tmpdir(), 'hakka-exit-'))
  const build = await Bun.build({
    entrypoints: [ENTRY],
    target: 'node',
    conditions: ['source'],
    outdir: dir,
    naming: 'hakka-node.mjs',
  })
  if (!build.success) throw new Error(build.logs.join('\n'))
  const file = join(dir, 'script.mjs')
  writeFileSync(file, source)
  const child = spawn(NODE ?? 'node', [file], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  try {
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
    return { exited, stdout }
  } finally {
    child.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  }
}

function captureScript(bridgeUrl: string): string {
  return `
import { createServer } from 'node:http'
import { startCapture } from './hakka-node.mjs'

startCapture({ bridgeUrl: ${JSON.stringify(bridgeUrl)} })
const server = createServer((_req, res) => res.end('ok'))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const res = await fetch('http://127.0.0.1:' + server.address().port + '/')
console.log('fetched', await res.text())
server.close()
`
}

describe.skipIf(!NODE)('process lifetime under node', () => {
  test('a script with capture running exits once its own work is done', async () => {
    const port = await freePort()
    const result = await runScript(captureScript(`ws://localhost:${port}`), 6000)
    expect(result.stdout).toContain('fetched ok')
    expect(result.exited).toBe(true)
  }, 10_000)

  test('a script whose bridge hub never answers still exits', async () => {
    const port = await freePort()
    const script = captureScript(`ws://localhost:${port}`).replace(
      'startCapture({',
      'startCapture({ embedBridge: false, ',
    )
    const result = await runScript(script, 6000)
    expect(result.stdout).toContain('fetched ok')
    expect(result.exited).toBe(true)
  }, 10_000)
})
