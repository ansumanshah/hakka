import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadCollection } from '../loadCollection'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function project(version?: number): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'hakka-format-'))
  directories.push(path)
  await writeFile(
    join(path, 'collection.hakka'),
    JSON.stringify({ id: 'test', name: 'Test', version, defaultHeaders: [], auth: { none: {} } }),
  )
  return path
}
test('rejects future collection formats before loading requests', async () => {
  const path = await project(5)
  await expect(loadCollection(path)).rejects.toThrow('requires a newer Hakka')
})
test('accepts current and unversioned collections', async () => {
  for (const version of [undefined, 4]) {
    const path = await project(version)
    expect((await loadCollection(path)).requests).toEqual([])
  }
})
test('ignores unrelated directories but fails on malformed folder metadata', async () => {
  const path = await project(4)
  const folder = join(path, 'requests')
  await mkdir(folder)
  expect((await loadCollection(path)).requests).toEqual([])
  await writeFile(join(folder, 'folder.hakka'), '{broken')
  await expect(loadCollection(path)).rejects.toThrow()
})
test('fails on missing folder auth instead of silently dropping its requests', async () => {
  const path = await project(4)
  const folder = join(path, 'requests')
  await mkdir(folder)
  await writeFile(join(folder, 'folder.hakka'), JSON.stringify({ seq: 0, id: 'folder', name: 'Requests', headers: [] }))
  await expect(loadCollection(path)).rejects.toThrow('folder.auth must be an object')
})
