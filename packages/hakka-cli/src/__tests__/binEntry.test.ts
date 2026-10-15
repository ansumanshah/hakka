import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dist = resolve(import.meta.dir, '../../dist/cli.mjs')

// npm exposes bins as symlinks (node_modules/.bin/hakka), so the entry must run
// when argv[1] is a symlink to the built file, not only when it is the file itself.
describe.skipIf(!existsSync(dist))('installed hakka bin', () => {
  const link = join(mkdtempSync(join(tmpdir(), 'hakka-bin-')), 'hakka')
  symlinkSync(dist, link)
  const run = (...args: string[]) => spawnSync(process.execPath, [link, ...args], { encoding: 'utf8' })

  test('prints usage through a symlink', () => {
    const r = run('--help')
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toContain('hakka run')
  })

  test('prints the package version', () => {
    const r = run('--version')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('subcommand --help prints usage instead of running the command', () => {
    const r = run('mcp', '--help')
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toContain('hakka mcp')
  })
})
