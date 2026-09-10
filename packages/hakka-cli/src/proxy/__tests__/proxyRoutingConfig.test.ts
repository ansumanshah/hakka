import { describe, expect, test } from 'bun:test'

import { normalizeProxyURL, parseProxyRoutingConfig } from '../proxyRoutingConfig'

describe('proxy routing configuration', () => {
  test('normalizes credential-free HTTP(S) endpoints and keeps authentication separate', () => {
    expect(normalizeProxyURL('https://proxy.example:8443/', 'proxy')).toBe('https://proxy.example:8443')
    expect(
      parseProxyRoutingConfig({
        version: 1,
        mode: 'upstream',
        upstream: {
          url: 'http://proxy.example:3128',
          authentication: { username: 'worker', password: 'secret' },
        },
      }),
    ).toEqual({
      version: 1,
      mode: 'upstream',
      upstream: {
        url: 'http://proxy.example:3128',
        authentication: { username: 'worker', password: 'secret' },
      },
    })
  })

  test('requires one explicit PAC source and exact endpoint-scoped authentication', () => {
    expect(
      parseProxyRoutingConfig({
        version: 1,
        mode: 'pac',
        pac: { file: '/tmp/routing.pac' },
        authentication: [
          {
            url: 'http://127.0.0.1:3128',
            authentication: { username: 'u', password: 'p' },
          },
        ],
      }),
    ).toMatchObject({ mode: 'pac', pac: { file: '/tmp/routing.pac' } })
    expect(() =>
      parseProxyRoutingConfig({ version: 1, mode: 'pac', pac: { file: '/tmp/a', url: 'https://example/pac' } }),
    ).toThrow('exactly one')
    expect(() =>
      parseProxyRoutingConfig({
        version: 1,
        mode: 'pac',
        pac: { file: '/tmp/a' },
        authentication: [{ url: 'http://127.0.0.1:3128' }],
      }),
    ).toThrow('require authentication')
  })

  test('rejects credentials in URLs, unsupported schemes, unknown fields, and line breaks', () => {
    for (const value of [
      { version: 1, mode: 'upstream', upstream: { url: 'http://u:p@proxy.example:80' } },
      { version: 1, mode: 'upstream', upstream: { url: 'socks5://proxy.example:1080' } },
      { version: 1, mode: 'direct', extra: true },
      {
        version: 1,
        mode: 'upstream',
        upstream: { url: 'http://proxy.example:80', authentication: { username: 'u\nInjected', password: '' } },
      },
    ]) {
      expect(() => parseProxyRoutingConfig(value)).toThrow()
    }
  })
})
