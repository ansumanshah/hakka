import { describe, expect, test } from 'bun:test'

import { buildUpstreamProxyArgs, MAX_UPSTREAM_PROXY_URL_LENGTH } from '../upstreamProxy'

describe('buildUpstreamProxyArgs', () => {
  test('emits mitmproxy upstream mode for HTTP, HTTPS, and IPv6 proxies', () => {
    expect(buildUpstreamProxyArgs('http://proxy.example:8080')).toEqual([
      '--mode',
      'upstream:http://proxy.example:8080',
    ])
    expect(buildUpstreamProxyArgs('https://proxy.example:443')).toEqual([
      '--mode',
      'upstream:https://proxy.example:443',
    ])
    expect(buildUpstreamProxyArgs('https://proxy.example:443/')).toEqual([
      '--mode',
      'upstream:https://proxy.example:443',
    ])
    expect(buildUpstreamProxyArgs('http://[2001:db8::1]:3128')).toEqual([
      '--mode',
      'upstream:http://[2001:db8::1]:3128',
    ])
  })

  test('accepts an empty setting without changing mitmproxy mode', () => {
    expect(buildUpstreamProxyArgs(undefined)).toEqual([])
    expect(buildUpstreamProxyArgs('  ')).toEqual([])
  })

  test('rejects URLs outside the bounded unauthenticated host and port form', () => {
    for (const value of [
      'socks5://proxy.example:1080',
      'http://proxy.example',
      'http://proxy.example:0',
      'http://proxy.example:65536',
      'http://user:pass@proxy.example:8080',
      'https://proxy.example:443/config',
      'https://proxy.example:443/a/..',
      'https://proxy.example:443/%2e',
      'https://proxy.example:443?pac=true',
      'https://proxy.example:443#fragment',
      'https://proxy\t.example:443',
      'https://proxy.example:１２３',
      `http://proxy.example:8080${'a'.repeat(MAX_UPSTREAM_PROXY_URL_LENGTH)}`,
    ]) {
      expect(() => buildUpstreamProxyArgs(value)).toThrow('--upstream-proxy')
    }
  })
})
