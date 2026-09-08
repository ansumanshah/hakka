import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadProxyMappings } from '../mapping'

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
})
