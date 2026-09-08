import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

const INTERNAL_STATE = '.hakka/team-sync.json'

interface SyncBase {
  revision: number
  files: Record<string, string>
}

interface RemoteSnapshot {
  revision: number
  files: Record<string, string>
}

export async function syncCollection(command: 'push' | 'pull', args: string[]): Promise<void> {
  const directory = args[0]
  const serverUrl = option(args, '--url')
  const token = option(args, '--token')
  if (!directory || directory.startsWith('--') || !serverUrl || !token) throw new Error('invalid team sync arguments')

  const requestedRoot = resolve(directory)
  const collection = basename(requestedRoot)
  const url = `${serverUrl.replace(/\/$/, '')}/api/v1/collections/${encodeURIComponent(collection)}`
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

  if (command === 'pull') {
    const response = await fetch(url, { headers })
    if (!response.ok) throw new Error(`pull failed: ${response.status}`)
    const remote = parseRemoteSnapshot(await response.json())
    await mkdir(requestedRoot, { recursive: true, mode: 0o700 })
    const root = await realpath(requestedRoot)
    const syncBase = await readBase(root, collection)
    const local = await readSnapshot(root)
    const merged = mergePull(local, syncBase?.files, remote.files)
    await applySnapshot(root, local, merged)
    await writeBase(root, collection, remote)
    process.stdout.write(JSON.stringify({ status: 'pulled', collection, revision: remote.revision }) + '\n')
    return
  }

  const root = await realpath(requestedRoot)
  const syncBase = await readBase(root, collection)
  const files = await readSnapshot(root)
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ revision: syncBase?.revision, files }),
  })
  if (response.status === 409) throw new Error('push conflict: pull and merge before retrying')
  if (!response.ok) throw new Error(`push failed: ${response.status}`)
  const remote = parseRemoteSnapshot(await response.json())
  await writeBase(root, collection, { revision: remote.revision, files })
  process.stdout.write(JSON.stringify({ status: 'pushed', collection, revision: remote.revision }) + '\n')
}

export async function writeSnapshot(root: string, files: Record<string, string>): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const canonical = await realpath(root)
  await applySnapshot(canonical, {}, files)
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function parseRemoteSnapshot(value: unknown): RemoteSnapshot {
  const data = record(value).data
  const snapshot = record(data)
  if (!Number.isInteger(snapshot.revision) || (snapshot.revision as number) < 1)
    throw new Error('Team server returned an invalid revision')
  const files = stringRecord(snapshot.files)
  for (const path of Object.keys(files)) validateSnapshotPath(path)
  return { revision: snapshot.revision as number, files }
}

function mergePull(
  local: Record<string, string>,
  base: Record<string, string> | undefined,
  remote: Record<string, string>,
): Record<string, string> {
  const merged = { ...local }
  const paths = new Set([...Object.keys(local), ...Object.keys(base ?? {}), ...Object.keys(remote)])
  for (const path of paths) {
    const localValue = local[path]
    const baseValue = base?.[path]
    const remoteValue = remote[path]
    if (!base) {
      if (localValue !== undefined && localValue !== remoteValue && remoteValue !== undefined)
        throw new Error(`Pull conflict: local file changed: ${path}`)
      if (localValue === undefined && remoteValue !== undefined) merged[path] = remoteValue
      continue
    }
    if (localValue === baseValue) setOrDelete(merged, path, remoteValue)
    else if (localValue === remoteValue || remoteValue === baseValue) continue
    else throw new Error(`Pull conflict: local and remote changed: ${path}`)
  }
  return merged
}

function setOrDelete(files: Record<string, string>, path: string, value: string | undefined): void {
  if (value === undefined) delete files[path]
  else files[path] = value
}

async function readSnapshot(root: string): Promise<Record<string, string>> {
  const canonical = await realpath(root)
  const result: Record<string, string> = {}
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      const path = relative(canonical, full)
      if (path === INTERNAL_STATE) continue
      if (entry.isSymbolicLink()) throw new Error(`Collection may not contain symlinks: ${path}`)
      // Serial traversal gives deterministic validation and avoids excessive open files.
      // eslint-disable-next-line no-await-in-loop
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && (entry.name.endsWith('.hakka') || entry.name.endsWith('.json')))
        // eslint-disable-next-line no-await-in-loop
        result[path] = await readFile(full, 'utf8')
    }
  }
  await walk(canonical)
  return result
}

async function applySnapshot(
  root: string,
  current: Record<string, string>,
  desired: Record<string, string>,
): Promise<void> {
  const canonical = await realpath(root)
  const paths = new Set([...Object.keys(current), ...Object.keys(desired)])
  for (const path of paths) {
    validateSnapshotPath(path)
    // Parent creation is ordered because snapshot paths can share directories.
    // eslint-disable-next-line no-await-in-loop
    await ensureSafeParents(canonical, path)
    const target = join(canonical, path)
    try {
      // eslint-disable-next-line no-await-in-loop
      const stat = await lstat(target)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Snapshot target is not a regular file: ${path}`)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  for (const path of paths) {
    if (current[path] === desired[path]) continue
    const target = join(canonical, path)
    if (desired[path] === undefined) {
      // Snapshot mutations remain ordered so failures have a deterministic boundary.
      // eslint-disable-next-line no-await-in-loop
      await unlink(target)
      continue
    }
    const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
    try {
      // eslint-disable-next-line no-await-in-loop
      await writeFile(temp, desired[path], { mode: 0o600, flag: 'wx' })
      // eslint-disable-next-line no-await-in-loop
      await rename(temp, target)
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await rm(temp, { force: true })
    }
  }
}

async function ensureSafeParents(root: string, path: string): Promise<void> {
  let cursor = root
  for (const part of path.split('/').slice(0, -1)) {
    cursor = join(cursor, part)
    try {
      // Parent components must be checked in order before descending further.
      // eslint-disable-next-line no-await-in-loop
      const stat = await lstat(cursor)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Snapshot path is unsafe: ${path}`)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // eslint-disable-next-line no-await-in-loop
      await mkdir(cursor, { mode: 0o700 })
    }
  }
}

const statePath = (root: string) => join(root, INTERNAL_STATE)

async function readBase(root: string, collection: string): Promise<SyncBase | undefined> {
  try {
    const target = statePath(root)
    const stat = await lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Team sync state is not a regular file')
    const state = record(JSON.parse(await readFile(target, 'utf8')))
    if (state.collection !== collection || !Number.isInteger(state.revision)) return
    return { revision: state.revision as number, files: stringRecord(state.files) }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

async function writeBase(root: string, collection: string, snapshot: RemoteSnapshot): Promise<void> {
  await ensureSafeParents(root, INTERNAL_STATE)
  const target = statePath(root)
  try {
    const stat = await lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Team sync state is not a regular file')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temp = join(dirname(target), `.team-sync.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, JSON.stringify({ collection, ...snapshot }) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temp, target)
  } finally {
    await rm(temp, { force: true })
  }
}

function validateSnapshotPath(path: string): void {
  const parts = path.split('/')
  if (
    !path ||
    path === INTERNAL_STATE ||
    path.startsWith('/') ||
    path.includes('\\') ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    (!path.endsWith('.hakka') && !path.endsWith('.json'))
  )
    throw new Error(`Invalid snapshot path: ${path}`)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Team server returned invalid JSON')
  return value as Record<string, unknown>
}

function stringRecord(value: unknown): Record<string, string> {
  const input = record(value)
  if (Object.values(input).some((item) => typeof item !== 'string')) throw new Error('Snapshot files must be strings')
  return input as Record<string, string>
}
