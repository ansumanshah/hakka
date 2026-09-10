import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createPacRouter } from '../pacRouting'

test('keeps explicit standard ports and scopes credentials to the matching PAC proxy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hakka-pac-routing-'))
  const pac = join(directory, 'routing.pac')
  writeFileSync(
    pac,
    'function FindProxyForURL() { return "PROXY proxy.example:80; HTTPS secure.example:443; DIRECT"; }',
  )
  const router = await createPacRouter({
    version: 1,
    mode: 'pac',
    pac: { file: pac },
    authentication: [
      {
        url: 'http://proxy.example:80',
        authentication: { username: 'only-this-proxy', password: 'secret' },
      },
    ],
  })
  try {
    expect(await router.resolve(new URL('https://destination.example/'))).toEqual([
      {
        kind: 'proxy',
        proxyURL: 'http://proxy.example:80',
        authentication: { username: 'only-this-proxy', password: 'secret' },
      },
      { kind: 'proxy', proxyURL: 'https://secure.example:443', authentication: undefined },
      { kind: 'direct' },
    ])
  } finally {
    router.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
