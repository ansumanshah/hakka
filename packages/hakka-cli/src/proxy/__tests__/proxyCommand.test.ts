import { describe, expect, it } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

describe('proxy command live status', () => {
  it('flushes the latest burst count while capture remains idle and active', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-status-'))
    const executable = join(directory, 'mitmdump')
    const command = join(directory, 'command.ts')
    let child: ReturnType<typeof Bun.spawn> | undefined
    try {
      writeFileSync(
        executable,
        `#!/usr/bin/env bun
console.log('{"type":"ready"}')
setTimeout(() => {
  for (let index = 0; index < 3; index++) {
    console.log(JSON.stringify({
      type: 'flow', id: 'burst-' + index, method: 'GET',
      url: 'http://example.test/' + index, startedAt: 1, endedAt: 2,
      requestHeaders: [], status: 200,
    }))
  }
}, 100)
setInterval(() => {}, 1000)
`,
      )
      chmodSync(executable, 0o755)
      const source = fileURLToPath(new URL('../../proxyCommand.ts', import.meta.url))
      writeFileSync(
        command,
        `import { runProxyCommand } from ${JSON.stringify(source)}
await runProxyCommand(${JSON.stringify(['--mitmdump', executable, '--duration-ms', '700', '--json'])})
`,
      )
      child = Bun.spawn([process.execPath, command], { stdout: 'pipe', stderr: 'pipe' })
      const [output, diagnostics, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(diagnostics).toBe('')
      expect(code).toBe(0)
      const events = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { status: string; records?: number })
      const lastLiveUpdate = events.findIndex((event) => event.status === 'status' && event.records === 3)
      const stopped = events.findIndex((event) => event.status === 'stopped')
      expect(lastLiveUpdate).toBeGreaterThan(events.findIndex((event) => event.status === 'started'))
      expect(lastLiveUpdate).toBeLessThan(stopped)
      expect(events[stopped]).toMatchObject({ records: 3 })
      expect(events.slice(stopped + 1)).toEqual([])
    } finally {
      if (child) {
        child.kill()
        await child.exited
      }
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
