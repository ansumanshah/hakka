import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const packageDir = resolve(import.meta.dir, '../../..')

function resolveClientEntry(conditions: string[]): string {
  const flags = conditions.map((c) => `--conditions=${c}`)
  const result = Bun.spawnSync({
    cmd: ['node', ...flags, '--input-type=module', '-e', "console.log(import.meta.resolve('hakka-node/next/client'))"],
    cwd: packageDir,
  })
  expect(result.exitCode).toBe(0)
  return result.stdout.toString().trim()
}

// These resolve through the built `dist/`; `bun run build` runs before `bun run test`.
describe('hakka-node/next/client export conditions', () => {
  test('a production bundle resolves the no-op entry', () => {
    expect(resolveClientEntry(['production'])).toEndWith('/dist/next/client.noop.mjs')
  })

  test('a development bundle resolves the real entry', () => {
    expect(resolveClientEntry([])).toEndWith('/dist/next/client.mjs')
  })

  test('the production entry cannot load the overlay', () => {
    const source = readFileSync(resolve(packageDir, 'dist/next/client.noop.mjs'), 'utf8')
    expect(source).not.toContain('hakka-browser')
  })
})
