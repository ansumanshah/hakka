import { describe, expect, it } from 'bun:test'

import { parseProxyArgs } from '../../proxyCommand'

describe('TLS proxy command configuration', () => {
  it('keeps repeatable literal bypass hosts in one scope', () => {
    expect(
      parseProxyArgs(['--tls-bypass-host', '*.example.com', '--tls-bypass-host', 'api.test:443']).tlsHostScope,
    ).toEqual({
      mode: 'bypass',
      hosts: ['*.example.com', 'api.test:443'],
    })
  })
  it('rejects contradictory modes and malformed hosts before startup', () => {
    expect(() => parseProxyArgs(['--tls-bypass-host', 'api.test', '--tls-allow-host', 'other.test'])).toThrow('either')
    expect(() => parseProxyArgs(['--tls-allow-host', '.*'])).toThrow('Invalid TLS host')
    expect(() => parseProxyArgs(['--tls-allow-host'])).toThrow('requires a value')
  })
})

describe('advanced proxy command configuration', () => {
  it('parses routing, script, and canonical network condition flags', () => {
    expect(
      parseProxyArgs([
        '--routing-config',
        'routing.json',
        '--script',
        'hooks.js',
        '--network-profile',
        'custom',
        '--latency-ms',
        '25',
        '--upload-bps',
        '1024',
        '--download-bps',
        '2048',
      ]),
    ).toMatchObject({
      routingConfig: 'routing.json',
      scriptPath: 'hooks.js',
      bandwidth: {
        profile: 'custom',
        latencyMs: 25,
        uploadBytesPerSecond: 1024,
        downloadBytesPerSecond: 2048,
      },
    })
  })

  it('rejects conflicting routing and invalid profiles before startup', () => {
    expect(() => parseProxyArgs(['--routing-config', 'routing.json', '--upstream-proxy', 'http://proxy:8080'])).toThrow(
      'cannot be combined',
    )
    expect(() => parseProxyArgs(['--network-profile', 'satellite'])).toThrow('Unknown bandwidth profile')
    expect(() => parseProxyArgs(['--network-profile', 'slow-3g', '--latency-ms', '1'])).toThrow(
      'does not accept custom',
    )
  })
})
