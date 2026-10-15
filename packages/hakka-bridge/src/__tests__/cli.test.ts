import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', 'cli.ts')

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs the CLI and kills it after `ms` if it is still running (code is then null). */
function runCli(args: string[], ms = 3000): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HAKKA_BRIDGE_PORT: '', HAKKA_NO_MDNS: '1' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    const timer = setTimeout(() => child.kill('SIGKILL'), ms)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

function occupyPort(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

describe('hakka-bridge CLI', () => {
  test.each([['--help'], ['-h']])('%s prints usage and exits without starting a hub', async (flag) => {
    const result = await runCli([flag])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Usage: hakka-bridge')
    expect(result.stdout).toContain('--port')
    expect(result.stdout).not.toContain('listening')
  })

  test.each([['abc'], ['0'], ['70000'], [undefined]])('rejects --port %s with exit code 2', async (value) => {
    const result = await runCli(value === undefined ? ['--port'] : ['--port', value])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--port')
    expect(result.stdout).not.toContain('listening')
  })

  test('a port already in use prints one line naming the port and exits 1', async () => {
    const blocker = await occupyPort()
    const { port } = blocker.address() as { port: number }
    try {
      const result = await runCli(['--port', String(port)])
      expect(result.code).toBe(1)
      const lines = result.stderr.trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`Port ${port} is already in use`)
      expect(lines[0]).toContain('--port')
    } finally {
      blocker.close()
    }
  })
})
