import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTeamServer } from '../server.js'
import { TeamStore } from '../store.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})
describe('team HTTP service', () => {
  test('requires auth and rejects stale collection revisions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hakka-team-'))
    const store = new TeamStore(join(dir, 'state.json'))
    await store.open()
    await store.bootstrap('bootstrap')
    const server = createTeamServer(store)
    const { port } = await server.listen(0, '127.0.0.1')
    close = () => server.close()
    const url = `http://127.0.0.1:${port}/api/v1/collections/demo`
    const headers = { authorization: 'Bearer bootstrap', 'content-type': 'application/json' }
    expect((await fetch(url)).status).toBe(401)
    expect(
      (await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ files: { 'collection.hakka': '{}' } }) }))
        .status,
    ).toBe(200)
    expect(
      (
        await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ revision: 0, files: { 'collection.hakka': '{}' } }),
        })
      ).status,
    ).toBe(409)
    const tokenResponse = await fetch(`http://127.0.0.1:${port}/api/v1/tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ memberId: 'reader', role: 'read' }),
    })
    const reader = ((await tokenResponse.json()) as { data: { token: string } }).data.token
    expect(
      (
        await fetch(url, {
          method: 'PUT',
          headers: { ...headers, authorization: `Bearer ${reader}` },
          body: JSON.stringify({ revision: 1, files: { 'collection.hakka': '{}' } }),
        })
      ).status,
    ).toBe(403)
    await rm(dir, { recursive: true, force: true })
  })

  test('rejects malformed JSON without terminating the server and revoked tokens stop authenticating', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hakka-team-'))
    const store = new TeamStore(join(dir, 'state.json'))
    await store.open()
    await store.bootstrap('bootstrap')
    const server = createTeamServer(store)
    const { port } = await server.listen(0, '127.0.0.1')
    close = () => server.close()
    const base = `http://127.0.0.1:${port}`
    const headers = { authorization: 'Bearer bootstrap', 'content-type': 'application/json' }

    const malformed = await fetch(`${base}/api/v1/tokens`, { method: 'POST', headers, body: '{' })
    expect(malformed.status).toBe(400)
    expect((await fetch(`${base}/healthz`)).status).toBe(200)

    const issuedResponse = await fetch(`${base}/api/v1/tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ memberId: 'reader', role: 'read' }),
    })
    const issued = (await issuedResponse.json()) as { data: { id: string; token: string } }
    expect(
      (
        await fetch(`${base}/api/v1/collections/demo`, {
          headers: { authorization: `Bearer ${issued.data.token}` },
        })
      ).status,
    ).toBe(404)
    expect((await fetch(`${base}/api/v1/tokens/${issued.data.id}`, { method: 'DELETE', headers })).status).toBe(204)
    expect(
      (
        await fetch(`${base}/api/v1/collections/demo`, {
          headers: { authorization: `Bearer ${issued.data.token}` },
        })
      ).status,
    ).toBe(401)
    await rm(dir, { recursive: true, force: true })
  })

  test('pins the admin-approved collection revision for a secret-bearing monitor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hakka-team-'))
    const store = new TeamStore(join(dir, 'state.json'))
    await store.open()
    await store.bootstrap('bootstrap')
    const server = createTeamServer(store)
    const { port } = await server.listen(0, '127.0.0.1')
    close = () => server.close()
    const base = `http://127.0.0.1:${port}/api/v1`
    const headers = { authorization: 'Bearer bootstrap', 'content-type': 'application/json' }
    const collection = `${base}/collections/demo`
    await fetch(collection, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ files: { 'collection.hakka': 'approved' } }),
    })
    await fetch(`${base}/secrets/API_TOKEN`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ value: 'protected-value' }),
    })
    const created = await fetch(`${base}/monitors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ collectionId: 'demo', intervalMs: 60_000, secretRefs: ['API_TOKEN'] }),
    })
    expect(created.status).toBe(201)
    const monitor = (await created.json()) as {
      data: { pinnedRevision: number; pinnedFiles: Record<string, string> }
    }
    await fetch(collection, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ revision: 1, files: { 'collection.hakka': 'unreviewed' } }),
    })
    expect(monitor.data.pinnedRevision).toBe(1)
    expect(monitor.data.pinnedFiles).toEqual({ 'collection.hakka': 'approved' })
    await rm(dir, { recursive: true, force: true })
  })
})
