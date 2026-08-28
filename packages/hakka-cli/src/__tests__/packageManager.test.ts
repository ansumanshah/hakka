import { describe, expect, test } from 'bun:test'

import { installCommand, type PackageManager } from '../packageManager'

describe('installCommand', () => {
  test('builds the right install invocation per package manager', () => {
    const cases: Array<[PackageManager, string]> = [
      ['bun', 'bun add hakka-browser'],
      ['pnpm', 'pnpm add hakka-browser'],
      ['yarn', 'yarn add hakka-browser'],
      ['npm', 'npm i hakka-browser'],
    ]
    for (const [pm, expected] of cases) {
      expect(installCommand(pm, ['hakka-browser'])).toBe(expected)
    }
  })

  test('joins multiple specs and supports a dev flag', () => {
    expect(installCommand('npm', ['hakka-node', 'hakka-browser'])).toBe('npm i hakka-node hakka-browser')
    expect(installCommand('bun', ['hakka-browser'], true)).toBe('bun add -d hakka-browser')
    expect(installCommand('yarn', ['hakka-browser'], true)).toBe('yarn add -D hakka-browser')
  })
})
