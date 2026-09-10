import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { runCollection } from '../../runCommand.js'
import { CollectionWorkspace } from '../../workspace/CollectionWorkspace.js'
import { registerCollectionWorkspaceTools } from '../tools/collectionWorkspace.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function connect(root: string): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '1' })
  registerCollectionWorkspaceTools(server, root)
  const client = new Client({ name: 'test', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(left)
  await client.connect(right)
  cleanup.push(async () => {
    await client.close()
    await server.close()
  })
  return client
}
function payload(result: { content: unknown }): Record<string, unknown> {
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
}

describe('collection workspace MCP tools', () => {
  it('redacts literal credentials while preserving references and public headers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-redaction-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const workspace = new CollectionWorkspace(root)
    await workspace.createCollection({ id: 'demo', name: 'Demo' })
    await workspace.createRequest('demo', {
      id: 'request',
      name: 'OAuth',
      url: 'https://example.test',
      headers: [
        { name: 'X-Api-Key', value: 'literal-api-key' },
        { name: 'Accept', value: 'application/json' },
        { name: 'Authorization', value: '{{AUTH}}' },
      ],
      auth: {
        oauth2: {
          _0: {
            grant: {
              clientCredentials: {
                _0: {
                  tokenURL: 'https://auth.example.test/token',
                  clientId: 'public-client',
                  clientSecret: 'literal-client-secret',
                },
              },
            },
          },
        },
      },
    })
    const result = JSON.stringify((await workspace.readRequest('demo', 'request')).value)
    expect(result).not.toContain('literal-api-key')
    expect(result).not.toContain('literal-client-secret')
    expect(result).toContain('{{AUTH}}')
    expect(result).toContain('application/json')
    expect(result).toContain('public-client')
  })

  it('serializes concurrent creates of the same request ID across different filenames', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-create-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const workspace = new CollectionWorkspace(root)
    await workspace.createCollection({ id: 'demo', name: 'Demo' })
    const results = await Promise.allSettled([
      workspace.createRequest('demo', { id: 'same', name: 'First', url: 'https://example.test/first' }),
      workspace.createRequest('demo', { id: 'same', name: 'Second', url: 'https://example.test/second' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('persists finite sessions and rejects ambiguous protocol variants', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-session-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const workspace = new CollectionWorkspace(root)
    await workspace.createCollection({ id: 'demo', name: 'Demo' })
    const session = { webSocket: { sendFrames: [{ data: 'echo', isBinary: false }], maxFrames: 1, timeoutMs: 1000 } }
    await workspace.createRequest('demo', { id: 'ws', name: 'Echo', url: 'ws://127.0.0.1:8081', session })
    expect((await workspace.readRequest('demo', 'ws')).value.spec).toMatchObject({ session })
    await expect(
      workspace.createRequest('demo', {
        name: 'Invalid',
        session: { ...session, sse: { maxEvents: 1, timeoutMs: 1000 } },
      }),
    ).rejects.toThrow('exactly one')
  })
  it('persists native Codable request fixtures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-native-fixtures-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const workspace = new CollectionWorkspace(root)
    await workspace.createCollection({ id: 'demo', name: 'Demo' })
    const header = { id: 'field', name: 'field', value: 'value', enabled: true }
    const multipart = {
      id: 'part',
      name: 'upload',
      value: '',
      filePath: '/tmp/upload',
      contentType: 'text/plain',
      enabled: true,
    }
    const fixtures = [
      { body: { none: {} }, auth: { inherit: {} } },
      {
        body: { raw: { text: '{"ok":true}', contentType: 'application/json' } },
        auth: { basic: { username: 'user', password: 'pass' } },
      },
      { body: { form: { _0: [header] } }, auth: { bearer: { token: '{{TOKEN}}' } } },
      {
        body: { multipart: { _0: [multipart] } },
        auth: { apiKey: { name: 'X-Key', value: '{{KEY}}', placement: 'header' } },
      },
      {
        body: { graphql: { query: 'query Ping { ping }', variables: '{}', operationName: 'Ping' } },
        auth: { oauth2: { _0: { grant: { staticToken: { accessToken: '{{TOKEN}}' } } } } },
      },
      { body: { file: { path: '/tmp/upload', contentType: 'application/octet-stream' } }, auth: { none: {} } },
      { body: { grpcMessage: { hex: '00ff' } }, auth: { none: {} } },
    ]
    await Promise.all(
      fixtures.map((fixture, index) =>
        workspace.createRequest('demo', {
          id: `fixture-${index}`,
          name: `Fixture ${index}`,
          url: 'https://example.test',
          ...fixture,
          assertions: [{ id: 'status', target: { status: {} }, op: 'equals', expected: '200', enabled: true }],
          scripts: { preRequestLines: ['vars.set("before", "1")'], postResponseLines: ['vars.set("after", "1")'] },
        }),
      ),
    )
  })
  it('rejects malformed native request fields without rewriting the existing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-contract-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const workspace = new CollectionWorkspace(root)
    await workspace.createCollection({ id: 'demo', name: 'Demo' })
    const created = await workspace.createRequest('demo', {
      id: 'request',
      name: 'Request',
      url: 'https://example.test',
    })
    const directory = (await readdir(root)).find((entry) => entry !== 'environments')!
    const file = join(root, directory, 'request-request.hakka')
    const before = await readFile(file, 'utf8')
    const invalid = [
      { body: { raw: { text: '{}', contentType: 42 } }, path: 'body.raw.contentType' },
      { auth: { apiKey: { name: 'X-Key', value: 'value', placement: 'cookie' } }, path: 'auth.apiKey.placement' },
      {
        assertions: [{ id: 'status', target: { status: {} }, op: 'sometimes', expected: '200', enabled: true }],
        path: 'assertions[0].op',
      },
      { scripts: { preRequestLines: ['ok'], postResponseLines: [42] }, path: 'scripts.postResponseLines[0]' },
    ]
    await invalid.reduce(async (previous, patch) => {
      await previous
      await expect(
        workspace.updateRequest('demo', 'request', { ...patch, expectedRevision: created.revision }),
      ).rejects.toThrow(patch.path)
      expect(await readFile(file, 'utf8')).toBe(before)
    }, Promise.resolve())
  })
  it('preserves an MCP target while a native writer owns the collection lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-lock-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const workspace = new CollectionWorkspace(root)
    await workspace.createCollection({ id: 'demo', name: 'Demo' })
    const created = await workspace.createRequest('demo', {
      id: 'request',
      name: 'Request',
      url: 'https://example.test',
    })
    const directory = (await readdir(root)).find((entry) => entry !== 'environments')!
    const file = join(root, directory, 'request-request.hakka')
    const before = await readFile(file, 'utf8')
    await writeFile(join(root, directory, '.hakka-write.lock'), 'native')

    await expect(
      workspace.updateRequest('demo', 'request', { name: 'Changed', expectedRevision: created.revision }),
    ).rejects.toThrow('Hakka writer')
    expect(await readFile(file, 'utf8')).toBe(before)
  })
  it('does not automatically reclaim an old lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-stale-lock-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const workspace = new CollectionWorkspace(root)
    const collection = await workspace.createCollection({ id: 'demo', name: 'Demo' })
    const directory = (await readdir(root)).find((entry) => entry !== 'environments')!
    const lock = join(root, directory, '.hakka-write.lock')
    const staleLock = JSON.stringify({ version: 1, pid: 2_147_483_647, nonce: 'crashed', createdAt: 0 })
    await writeFile(lock, staleLock)

    await expect(
      workspace.updateCollection('demo', { name: 'Recovered', expectedRevision: collection.revision }),
    ).rejects.toThrow('.hakka-write.lock and retry')
    expect(await readFile(lock, 'utf8')).toBe(staleLock)
    expect((await workspace.readCollection('demo')).value.name).toBe('Demo')
  })
  it('rejects invalid folder auth before replacing its metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-folder-contract-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const workspace = new CollectionWorkspace(root)
    await workspace.createCollection({ id: 'demo', name: 'Demo' })
    const folder = await workspace.createFolder('demo', { id: 'folder', name: 'Folder' })
    const directory = (await readdir(root)).find((entry) => entry !== 'environments')!
    const file = join(root, directory, 'folder-folder', 'folder.hakka')
    const before = await readFile(file, 'utf8')

    await expect(
      workspace.updateFolder('demo', 'folder', { auth: {} as never, expectedRevision: folder.revision }),
    ).rejects.toThrow('auth must contain exactly one')
    expect(await readFile(file, 'utf8')).toBe(before)
  })
  it('authors a real runnable collection and enforces revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const client = await connect(root)
    const collection = payload(await client.callTool({ name: 'create_collection', arguments: { name: 'Health' } }))
    const collectionValue = collection.value as Record<string, unknown>
    expect(collectionValue.version).toBe(4)
    const request = payload(
      await client.callTool({
        name: 'create_collection_request',
        arguments: { collectionId: collectionValue.id, name: 'Ping', url: 'http://127.0.0.1:1' },
      }),
    )
    const requestValue = request.value as Record<string, unknown>
    expect((requestValue.spec as Record<string, unknown>).body).toEqual({ none: {} })
    const duplicate = await client.callTool({
      name: 'create_collection_request',
      arguments: {
        collectionId: collectionValue.id,
        id: (requestValue.spec as Record<string, unknown>).id,
        name: 'Duplicate',
        url: 'http://127.0.0.1:1',
      },
    })
    expect(duplicate.isError).toBe(true)
    const conflict = await client.callTool({
      name: 'update_collection_request',
      arguments: {
        collectionId: collectionValue.id,
        requestId: (requestValue.spec as Record<string, unknown>).id,
        expectedRevision: 'wrong-wrong',
        name: 'Nope',
      },
    })
    expect(conflict.isError).toBe(true)
    const secret = await client.callTool({
      name: 'create_environment',
      arguments: {
        collectionId: collectionValue.id,
        name: 'Prod',
        variables: [{ name: 'TOKEN', secret: true, secretRef: 'vault://token' }],
      },
    })
    expect(secret.isError).toBe(true)
    const folder = await readdir(root)
    const report = await runCollection(
      join(
        root,
        folder.find((item) => item !== 'environments')!,
      ),
      { timeoutMs: 10 },
    )
    expect(report.collection).toBe('Health')
  })

  it('refuses traversal and symlinked collection paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const client = await connect(root)
    const created = payload(await client.callTool({ name: 'create_collection', arguments: { name: 'Safe' } }))
    const collection = created.value as Record<string, unknown>
    const traversal = await client.callTool({
      name: 'create_folder',
      arguments: { collectionId: collection.id, name: '../escape' },
    })
    expect(traversal.isError).toBe(true)
    const outside = await mkdtemp(join(tmpdir(), 'hakka-outside-'))
    cleanup.push(() => rm(outside, { recursive: true, force: true }))
    await mkdir(join(outside, 'fake'))
    await symlink(join(outside, 'fake'), join(root, 'linked'))
    const list = await client.callTool({ name: 'list_collections', arguments: {} })
    expect(list.isError).toBeUndefined()
  })

  it('rejects a symlinked environment directory and serializes stale revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hakka-workspace-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const client = await connect(root)
    const created = payload(
      await client.callTool({ name: 'create_collection', arguments: { name: 'Safe', id: 'safe-collection' } }),
    )
    const collection = created.value as Record<string, unknown>
    const outside = await mkdtemp(join(tmpdir(), 'hakka-outside-'))
    cleanup.push(() => rm(outside, { recursive: true, force: true }))
    await writeFile(join(outside, 'victim.hakka'), JSON.stringify({ id: 'victim', name: 'external', variables: [] }))
    await mkdir(join(root, 'environments'))
    const dir = (await readdir(root)).find((entry) => entry !== 'environments')!
    await symlink(outside, join(root, 'environments', dir))
    const escaped = await client.callTool({
      name: 'read_environment',
      arguments: { collectionId: collection.id, environmentId: 'victim' },
    })
    expect(escaped.isError).toBe(true)
    const updates = await Promise.allSettled([
      client.callTool({
        name: 'update_collection',
        arguments: { collectionId: collection.id, expectedRevision: created.revision, name: 'First' },
      }),
      client.callTool({
        name: 'update_collection',
        arguments: { collectionId: collection.id, expectedRevision: created.revision, notes: 'Second' },
      }),
    ])
    expect(updates.filter((item) => item.status === 'fulfilled' && !item.value.isError)).toHaveLength(1)
  })
})
