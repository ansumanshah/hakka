import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTeamServer, type TeamServer } from '../server.js'
import { TeamStore } from '../store.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function setup() {
  const parent = await mkdtemp(join(tmpdir(), 'hakka-team-sync-'))
  const directory = join(parent, 'demo')
  await mkdir(directory)
  const store = new TeamStore(join(parent, 'state.json'))
  await store.open()
  await store.bootstrap('bootstrap')
  const server: TeamServer = createTeamServer(store)
  const { port } = await server.listen(0, '127.0.0.1')
  cleanups.push(
    async () => server.close(),
    async () => rm(parent, { recursive: true, force: true }),
  )
  const baseUrl = `http://127.0.0.1:${port}`
  const headers = { authorization: 'Bearer bootstrap', 'content-type': 'application/json' }
  const command = async (name: 'push' | 'pull'): Promise<void> => {
    const cli = join(import.meta.dir, '..', '..', 'cli.ts')
    const child = Bun.spawn(
      [process.execPath, cli, 'team', name, directory, '--url', baseUrl, '--token', 'bootstrap'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const stdout = new Response(child.stdout).text()
    const stderr = new Response(child.stderr).text()
    const exitCode = await child.exited
    if (exitCode !== 0) throw new Error((await stderr).trim())
    await stdout
  }
  return { directory, baseUrl, headers, command }
}

describe('team collection CLI synchronization', () => {
  test('repeated pushes use the saved revision and never upload internal sync metadata', async () => {
    const { directory, baseUrl, headers, command } = await setup()
    await writeFile(join(directory, 'collection.hakka'), '{"name":"one"}')
    await command('push')
    await command('push')

    const response = await fetch(`${baseUrl}/api/v1/collections/demo`, { headers })
    const snapshot = (await response.json()) as { data: { revision: number; files: Record<string, string> } }
    expect(snapshot.data.revision).toBe(2)
    expect(snapshot.data.files).toEqual({ 'collection.hakka': '{"name":"one"}' })
  })

  test('pull fast-forwards a remotely changed file when local still matches its base', async () => {
    const { directory, baseUrl, headers, command } = await setup()
    const path = join(directory, 'collection.hakka')
    await writeFile(path, 'one')
    await command('push')
    await fetch(`${baseUrl}/api/v1/collections/demo`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ revision: 1, files: { 'collection.hakka': 'two' } }),
    })

    await command('pull')
    expect(await readFile(path, 'utf8')).toBe('two')
  })

  test('a true pull conflict preserves every local file and the prior base revision', async () => {
    const { directory, baseUrl, headers, command } = await setup()
    const first = join(directory, 'first.hakka')
    const second = join(directory, 'second.json')
    await writeFile(first, 'one')
    await writeFile(second, 'base')
    await command('push')
    await writeFile(second, 'local')
    await fetch(`${baseUrl}/api/v1/collections/demo`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ revision: 1, files: { 'first.hakka': 'remote', 'second.json': 'remote' } }),
    })

    await expect(command('pull')).rejects.toThrow('local and remote changed: second.json')
    expect(await readFile(first, 'utf8')).toBe('one')
    expect(await readFile(second, 'utf8')).toBe('local')
    const state = JSON.parse(await readFile(join(directory, '.hakka', 'team-sync.json'), 'utf8')) as {
      revision: number
    }
    expect(state.revision).toBe(1)
  })

  test('push rejects collection and metadata symlinks', async () => {
    const first = await setup()
    const outside = join(first.directory, '..', 'outside.json')
    await writeFile(outside, '{}')
    await symlink(outside, join(first.directory, 'linked.json'))
    await expect(first.command('push')).rejects.toThrow('may not contain symlinks')

    const second = await setup()
    await mkdir(join(second.directory, '.hakka'))
    await symlink(outside, join(second.directory, '.hakka', 'team-sync.json'))
    await writeFile(join(second.directory, 'collection.hakka'), '{}')
    await expect(second.command('push')).rejects.toThrow('sync state is not a regular file')
  })
})
