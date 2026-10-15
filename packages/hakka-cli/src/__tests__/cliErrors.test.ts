import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const CLI = join(import.meta.dir, '..', 'cli.ts')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[], options: { cwd?: string; path?: string } = {}): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, ...(options.path ? { PATH: options.path } : {}) },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** A Vite project whose `pnpm` exits with `exitCode`, so `hakka init` runs a real but fake install. */
function viteProjectWithPnpm(exitCode: number): { cwd: string; path: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'hakka-init-'))
  dirs.push(cwd)
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'app', devDependencies: { vite: '^7.0.0' } }))
  writeFileSync(join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  const bin = join(cwd, '.fake-bin')
  mkdirSync(bin)
  const pnpm = join(bin, 'pnpm')
  writeFileSync(pnpm, `#!/bin/sh\nexit ${exitCode}\n`)
  chmodSync(pnpm, 0o755)
  return { cwd, path: `${bin}${delimiter}${process.env.PATH ?? ''}` }
}

describe('hakka init install result', () => {
  test('a failed install is reported with the command and a non-zero exit, never as success', () => {
    const result = runCli(['init'], viteProjectWithPnpm(1))
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain("You're capturing.")
    expect(result.stderr).toContain('pnpm add hakka-browser')
  })

  test('a successful install reports success and exits 0', () => {
    const result = runCli(['init'], viteProjectWithPnpm(0))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("You're capturing.")
  })
})

describe('expected failures print one line', () => {
  let blocker: Server | null = null
  afterEach(() => {
    blocker?.close()
    blocker = null
  })

  test('hakka cdp against a closed debugging port prints no stack trace', () => {
    const result = runCli(['cdp', '--port', '1'])
    expect(result.status).toBe(1)
    expect(result.stderr.trim().split('\n')).toHaveLength(1)
    expect(result.stderr).not.toMatch(/^\s+at /m)
  })

  test('a missing mitmdump explains how to install mitmproxy', () => {
    const result = runCli(['proxy', '--mitmdump', 'hakka-missing-mitmdump'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('brew install mitmproxy')
    expect(result.stderr).toContain('pipx install mitmproxy')
  })

  test('a port already in use prints one line that suggests --port', async () => {
    blocker = await new Promise<Server>((resolve) => {
      const server = createServer()
      server.listen(0, '127.0.0.1', () => resolve(server))
    })
    const { port } = blocker.address() as { port: number }
    const cwd = mkdtempSync(join(tmpdir(), 'hakka-team-'))
    dirs.push(cwd)
    const result = runCli(['team', 'serve', '--port', String(port)], { cwd })
    expect(result.status).toBe(1)
    const lines = result.stderr.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`Port ${port} is already in use`)
    expect(lines[0]).toContain('--port')
  })
})
