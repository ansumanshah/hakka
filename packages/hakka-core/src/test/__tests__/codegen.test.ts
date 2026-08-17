import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { NetworkRequest } from '../../model/types'
import { generateTestFile } from '../codegen'

let idSeq = 0
function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  idSeq++
  return {
    id: `codegen-req-${idSeq}`,
    url: 'https://api.example.com/users/1',
    method: 'GET',
    status: 200,
    startTime: idSeq,
    duration: 42,
    responseBody: '{"id":1,"name":"Ada"}',
    ...overrides,
  }
}

describe('generateTestFile — grouping by host', () => {
  test('emits one describe block per unique host', () => {
    const requests = [
      makeRequest({ url: 'https://api.example.com/users/1' }),
      makeRequest({ url: 'https://api.example.com/orders/9' }),
      makeRequest({ url: 'https://cdn.example.com/logo.png' }),
    ]
    const code = generateTestFile(requests)
    expect(code).toContain('describe("api.example.com"')
    expect(code).toContain('describe("cdn.example.com"')
  })

  test('hosts are emitted in sorted order', () => {
    const requests = [
      makeRequest({ url: 'https://zzz.example.com/a' }),
      makeRequest({ url: 'https://aaa.example.com/b' }),
    ]
    const code = generateTestFile(requests)
    expect(code.indexOf('aaa.example.com')).toBeLessThan(code.indexOf('zzz.example.com'))
  })

  test('groups multiple requests to the same host under one describe block', () => {
    const requests = [
      makeRequest({ url: 'https://api.example.com/a' }),
      makeRequest({ url: 'https://api.example.com/b' }),
    ]
    const code = generateTestFile(requests)
    const occurrences = code.split('describe("api.example.com"').length - 1
    expect(occurrences).toBe(1)
    expect(code).toContain('it("GET /a → 200"')
    expect(code).toContain('it("GET /b → 200"')
  })

  test('empty input still produces a valid (empty) suite', () => {
    const code = generateTestFile([])
    expect(code).toContain('describe(')
    expect(code).toContain('No requests were captured')
  })
})

describe('generateTestFile — requests with no status are skipped', () => {
  test('emits a skip comment instead of an it() block', () => {
    const requests = [makeRequest({ status: undefined, url: 'https://api.example.com/pending' })]
    const code = generateTestFile(requests)
    expect(code).toContain('// skipped:')
    expect(code).toContain('/pending')
    expect(code).not.toContain("it('GET")
  })

  test('does not skip a request with status 0 is not applicable — skip only applies to null/undefined status', () => {
    const requests = [makeRequest({ status: 204, responseBody: undefined })]
    const code = generateTestFile(requests)
    expect(code).toContain('it("GET /users/1 → 204"')
    expect(code).not.toContain('// skipped:')
  })

  test('mixed skipped and asserted requests both appear', () => {
    const requests = [
      makeRequest({ status: undefined, url: 'https://api.example.com/pending' }),
      makeRequest({ status: 200, url: 'https://api.example.com/ready' }),
    ]
    const code = generateTestFile(requests)
    expect(code).toContain('// skipped:')
    expect(code).toContain('it("GET /ready → 200"')
  })
})

describe('generateTestFile — response-shape assertions (top-level keys only)', () => {
  test('asserts top-level keys of a JSON object body, not nested values', () => {
    const requests = [makeRequest({ responseBody: '{"id":1,"name":"Ada","meta":{"nested":true}}' })]
    const code = generateTestFile(requests)
    expect(code).toContain('expect(Object.keys(')
    expect(code).toContain('"id"')
    expect(code).toContain('"name"')
    expect(code).toContain('"meta"')
    // Must not assert the nested value itself.
    expect(code).not.toContain('"nested"')
    expect(code).not.toContain('true)')
  })

  test('asserts keys of the first element for a JSON array body', () => {
    const requests = [makeRequest({ responseBody: '[{"id":1},{"id":2}]' })]
    const code = generateTestFile(requests)
    expect(code).toContain('"id"')
  })

  test('non-JSON body produces no shape assertion', () => {
    const requests = [makeRequest({ responseBody: 'plain text response' })]
    const code = generateTestFile(requests)
    expect(code).not.toContain('Object.keys(')
  })

  test('missing body produces no shape assertion', () => {
    const requests = [makeRequest({ responseBody: undefined })]
    const code = generateTestFile(requests)
    expect(code).not.toContain('Object.keys(')
  })

  test('empty JSON object produces no shape assertion (nothing to check)', () => {
    const requests = [makeRequest({ responseBody: '{}' })]
    const code = generateTestFile(requests)
    expect(code).not.toContain('Object.keys(')
  })
})

describe('generateTestFile — duration upper bound', () => {
  test('emits a 10x generous duration bound with a comment', () => {
    const requests = [makeRequest({ duration: 50 })]
    const code = generateTestFile(requests)
    expect(code).toContain('Generous duration budget')
    expect(code).toContain('toBeLessThanOrEqual(500)')
  })

  test('rounds up fractional durations before multiplying', () => {
    const requests = [makeRequest({ duration: 0.5 })]
    const code = generateTestFile(requests)
    // ceil(0.5) * 10 = 5
    expect(code).toContain('toBeLessThanOrEqual(5)')
  })

  test('no duration on the request means no duration assertion', () => {
    const requests = [makeRequest({ duration: undefined })]
    const code = generateTestFile(requests)
    expect(code).not.toContain('Generous duration budget')
  })
})

describe('generateTestFile — core method/url/status assertions', () => {
  test('every non-skipped request asserts method, url, and status', () => {
    const requests = [makeRequest({ method: 'post', url: 'https://api.example.com/login', status: 201 })]
    const code = generateTestFile(requests)
    expect(code).toContain('method: "POST"')
    expect(code).toContain('url: "https://api.example.com/login"')
    expect(code).toContain('.withStatus(201)')
  })
})

describe('generateTestFile — framework import lines', () => {
  test('defaults to vitest', () => {
    const code = generateTestFile([makeRequest()])
    expect(code).toContain("from 'vitest'")
  })

  test('framework: bun imports from bun:test', () => {
    const code = generateTestFile([makeRequest()], { framework: 'bun' })
    expect(code).toContain("from 'bun:test'")
  })

  test('framework: jest imports from @jest/globals', () => {
    const code = generateTestFile([makeRequest()], { framework: 'jest' })
    expect(code).toContain("from '@jest/globals'")
  })

  test('framework: vitest explicit', () => {
    const code = generateTestFile([makeRequest()], { framework: 'vitest' })
    expect(code).toContain("from 'vitest'")
  })

  test('always imports expectRequest from hakka-core/test', () => {
    const code = generateTestFile([makeRequest()])
    expect(code).toContain("import { expectRequest } from 'hakka-core/test'")
  })
})

describe('generateTestFile — suite naming', () => {
  test('defaults to "Hakka captured session"', () => {
    const code = generateTestFile([makeRequest()])
    expect(code).toContain('describe("Hakka captured session"')
  })

  test('honors a custom suiteName', () => {
    const code = generateTestFile([makeRequest()], { suiteName: 'Checkout regression' })
    expect(code).toContain('describe("Checkout regression"')
  })
})

// Shells out to `tsc --noEmit` (this package's own `typescript` devDependency) against the
// generated file, using a local `globals.d.ts` shim for the three supported `framework` module
// shapes (avoids adding real devDependencies just to typecheck generated code) and `paths`
// mapped to this package's real dist output — what an actual consumer's import resolves to.
// Skipped (not failed) when dist isn't built yet; run `bun run build` first for full signal.

const HAKKA_CORE_TEST_DIST = join(import.meta.dir, '..', '..', '..', 'dist', 'test.d.mts')
const HAKKA_CORE_DIST = join(import.meta.dir, '..', '..', '..', 'dist', 'index.d.mts')
const TSC_BIN = join(import.meta.dir, '..', '..', '..', '..', '..', 'node_modules', '.bin', 'tsc')

const GLOBALS_SHIM = `
declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void
  export function it(name: string, fn: () => void): void
  interface HakkaCodegenMatchers<T = unknown> {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toBeLessThanOrEqual(expected: number): void
  }
  export const expect: {
    <T = unknown>(actual: T): HakkaCodegenMatchers<T>
    arrayContaining(expected: unknown[]): unknown
  }
}
declare module 'vitest' {
  export * from 'bun:test'
}
declare module '@jest/globals' {
  export * from 'bun:test'
}
`

function typecheckGenerated(code: string): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'hakka-codegen-typecheck-'))
  try {
    const testFile = join(dir, 'generated.test.ts')
    const globalsFile = join(dir, 'globals.d.ts')
    const tsconfigFile = join(dir, 'tsconfig.json')

    writeFileSync(testFile, code, 'utf8')
    writeFileSync(globalsFile, GLOBALS_SHIM, 'utf8')
    writeFileSync(
      tsconfigFile,
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            types: [],
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            paths: {
              'hakka-core/test': [HAKKA_CORE_TEST_DIST],
              'hakka-core': [HAKKA_CORE_DIST],
            },
          },
          include: ['generated.test.ts', 'globals.d.ts'],
        },
        null,
        2,
      ),
      'utf8',
    )

    const result = spawnSync(TSC_BIN, ['-p', tsconfigFile], { encoding: 'utf8' })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    return { ok: result.status === 0, output }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('generateTestFile — generated output typechecks', () => {
  const distReady = existsSync(HAKKA_CORE_TEST_DIST) && existsSync(HAKKA_CORE_DIST)

  test.if(distReady)('vitest-flavored output typechecks against real hakka-core/hakka-core/test dist', () => {
    const requests: NetworkRequest[] = [
      makeRequest({ url: 'https://api.example.com/users/1', responseBody: '{"id":1,"name":"Ada"}' }),
      makeRequest({ url: 'https://api.example.com/orders/9', method: 'POST', status: 201, responseBody: '[{"id":9}]' }),
      makeRequest({ url: 'https://api.example.com/pending', status: undefined }),
    ]
    const code = generateTestFile(requests, { framework: 'vitest', suiteName: 'Typecheck sample' })
    const { ok, output } = typecheckGenerated(code)
    expect(ok, `tsc reported errors:\n${output}\n\n--- generated file ---\n${code}`).toBe(true)
  })

  test.if(distReady)('bun-flavored output typechecks', () => {
    const requests: NetworkRequest[] = [makeRequest()]
    const code = generateTestFile(requests, { framework: 'bun' })
    const { ok, output } = typecheckGenerated(code)
    expect(ok, `tsc reported errors:\n${output}\n\n--- generated file ---\n${code}`).toBe(true)
  })

  test.if(distReady)('jest-flavored output typechecks', () => {
    const requests: NetworkRequest[] = [makeRequest()]
    const code = generateTestFile(requests, { framework: 'jest' })
    const { ok, output } = typecheckGenerated(code)
    expect(ok, `tsc reported errors:\n${output}\n\n--- generated file ---\n${code}`).toBe(true)
  })

  if (!distReady) {
    test.skip('skipped: hakka-core dist not built — run `bun run build` (this package) first', () => {
      // no-op placeholder so the skip reason is visible in test output
    })
  }
})
