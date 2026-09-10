import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadProxyConfiguration, loadProxyMappings } from '../mapping'

describe('loadProxyMappings', () => {
  test('uses an explicit regular file for map-local and preserves map-remote replacement', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-mapping-'))
    mkdirSync(join(directory, 'fixtures'))
    writeFileSync(join(directory, 'fixtures', 'response.json'), '{}')
    const config = join(directory, 'mappings.json')
    writeFileSync(
      config,
      JSON.stringify({
        mapLocal: [{ match: '^https://example.test/a$', file: './fixtures/response.json' }],
        mapRemote: [{ match: '^https://example.test/(.*)$', replace: 'http://127.0.0.1:4010/$1' }],
      }),
    )

    expect(loadProxyMappings(config)).toEqual({
      mapLocal: [`@^https://example.test/a$@${join(directory, 'fixtures', 'response.json')}`],
      mapRemote: ['@^https://example.test/(.*)$@http://127.0.0.1:4010/\\1'],
    })
  })

  test('rejects a directory map-local target', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-mapping-'))
    const config = join(directory, 'mappings.json')
    writeFileSync(config, JSON.stringify({ mapLocal: [{ match: 'example', file: '.' }] }))
    expect(() => loadProxyMappings(config)).toThrow('existing regular file')
  })

  test('loads phase-correct header, block, and bounded delay rules for the addon', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-rules-'))
    const config = join(directory, 'rules.json')
    writeFileSync(
      config,
      JSON.stringify({
        headerRules: [
          { match: '^https://api.example.test/', phase: 'request', operation: 'set', name: 'X-Test', value: 'yes' },
          { match: '^https://api.example.test/', phase: 'response', operation: 'remove', name: 'Set-Cookie' },
        ],
        blockRules: [{ match: '/telemetry$', status: 451, body: 'Disabled in this test.' }],
        delayRules: [{ match: '/slow$', phase: 'response', delayMs: 120 }],
      }),
    )

    expect(loadProxyConfiguration(config)).toMatchObject({
      addonConfigPath: config,
      rules: { header: 2, block: 1, delay: 1 },
    })
  })

  test('rejects invalid injection-prone headers and unbounded rule values before starting mitmproxy', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-rules-'))
    const config = join(directory, 'rules.json')
    writeFileSync(
      config,
      JSON.stringify({
        headerRules: [{ match: '.', phase: 'request', operation: 'set', name: 'X-Test\nBad', value: 'x' }],
      }),
    )
    expect(() => loadProxyConfiguration(config)).toThrow('valid HTTP header name')
    writeFileSync(
      config,
      JSON.stringify({
        headerRules: [{ match: '.', phase: 'request', operation: 'set', name: 'X-Test', value: 'ok\u0000bad' }],
      }),
    )
    expect(() => loadProxyConfiguration(config)).toThrow('without HTTP control characters')
    writeFileSync(config, JSON.stringify({ delayRules: [{ match: '.', phase: 'request', delayMs: 30_001 }] }))
    expect(() => loadProxyConfiguration(config)).toThrow('between 0 and 30000')
    writeFileSync(config, JSON.stringify({ blockRules: [{ match: '.', body: '\uD800' }] }))
    expect(() => loadProxyConfiguration(config)).toThrow('Unicode UTF-8')
  })

  test('rejects syntax that JavaScript accepts but Python re cannot execute', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-rules-'))
    const config = join(directory, 'rules.json')
    writeFileSync(config, JSON.stringify({ blockRules: [{ match: '(?<segment>api)' }] }))
    expect(() => loadProxyConfiguration(config)).toThrow('portable URL regular-expression subset')
    writeFileSync(config, JSON.stringify({ blockRules: [{ match: String.raw`\q` }] }))
    expect(() => loadProxyConfiguration(config)).toThrow('portable URL regular-expression subset')
    for (const expression of ['[]', '[^]', String.raw`[\B]`]) {
      writeFileSync(config, JSON.stringify({ blockRules: [{ match: expression }] }))
      expect(() => loadProxyConfiguration(config)).toThrow('portable URL regular-expression subset')
    }
    writeFileSync(config, JSON.stringify({ mapRemote: [{ match: '(?=api)', replace: 'https://example.test' }] }))
    expect(() => loadProxyConfiguration(config)).toThrow('portable URL regular-expression subset')
  })
})
