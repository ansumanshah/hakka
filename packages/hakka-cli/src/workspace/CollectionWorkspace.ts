import { createHash, randomUUID } from 'node:crypto'
import { lstat, link, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'

const FORMAT_VERSION = 4
const SECRET_REFERENCE = 'hakka-keychain-secret:v1'
const MAX_LIST = 100
const MAX_NAME = 120

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonObject = Record<string, Json>

export interface Revisioned<T> {
  value: T
  revision: string
}
export interface EnvironmentVariableInput {
  id?: string
  name: string
  value?: string
  secret?: boolean
  secretRef?: string
  enabled?: boolean
}
export interface RequestInput {
  id?: string
  name?: string
  method?: string
  url?: string
  headers?: Json[]
  query?: Json[]
  body?: JsonObject
  auth?: JsonObject
  assertions?: Json[]
  captures?: Json[]
  notes?: string | null
  timeout?: number | null
  followRedirects?: boolean
  scripts?: JsonObject | null
  session?: JsonObject | null
}

export class WorkspaceError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'invalid_input' | 'unsafe_workspace',
    message: string,
  ) {
    super(message)
  }
}

function object(value: unknown, label: string): JsonObject {
  if (value == null || Array.isArray(value) || typeof value !== 'object')
    throw new WorkspaceError('invalid_input', `${label} must be an object`)
  return value as JsonObject
}
function string(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()))
    throw new WorkspaceError('invalid_input', `${label} must be a non-empty string`)
  return value
}
function name(value: unknown, label: string): string {
  const result = string(value, label).trim()
  if (result.length > MAX_NAME || /[\\/\0]/.test(result))
    throw new WorkspaceError('invalid_input', `${label} is not a safe name`)
  return result
}
function id(value: unknown, label: string): string {
  return string(value, label).trim()
}
function revision(data: string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16)
}
function canonical(value: JsonObject): string {
  const sort = (item: Json): Json =>
    Array.isArray(item)
      ? item.map(sort)
      : item != null && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, sort(child)]),
          )
        : item
  return `${JSON.stringify(sort(value), null, 2)}\n`
}
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'item'
  )
}
function headerPairs(value: Json[] | undefined, label: string): Json[] {
  if (value === undefined) return []
  if (value.length > MAX_LIST) throw new WorkspaceError('invalid_input', `${label} must contain at most 100 headers`)
  return value.map((raw) => {
    const header = object(raw, label)
    return {
      id: header.id === undefined ? randomUUID() : id(header.id, `${label} id`),
      name: string(header.name, `${label} name`, true),
      value: string(header.value, `${label} value`, true),
      enabled: header.enabled !== false,
    }
  })
}
function redact(value: Json, parentKey = ''): Json {
  if (Array.isArray(value)) return value.map((child) => redact(child, parentKey))
  if (value == null || typeof value !== 'object') return value
  const result: JsonObject = {}
  const sensitiveName =
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|password|token|secret)$/i
  const sensitiveField = /^(authorization|password|clientSecret|accessToken|refreshToken|token|secret)$/i
  for (const [key, child] of Object.entries(value)) {
    const sensitive =
      sensitiveField.test(key) ||
      (key === 'value' &&
        (parentKey === 'apiKey' || (typeof value.name === 'string' && sensitiveName.test(value.name))))
    const reference = typeof child === 'string' && /^{{\s*[^{}\s]+\s*}}$/.test(child)
    result[key] = sensitive && typeof child === 'string' && !reference ? '[redacted]' : redact(child, key)
  }
  return result
}

/** A constrained authoring view over the Swift CollectionStore's directory format. */
export class CollectionWorkspace {
  private readonly root: string
  private static readonly writes = new Map<string, Promise<void>>()

  constructor(root: string) {
    this.root = resolve(root)
  }

  static fromEnvironment(root = process.env.HAKKA_WORKSPACE_DIR): CollectionWorkspace {
    if (!root)
      throw new WorkspaceError(
        'unsafe_workspace',
        'HAKKA_WORKSPACE_DIR must name the collection workspace; no implicit write location is used',
      )
    return new CollectionWorkspace(root)
  }

  private async assertNoSymlinkAncestors(path: string): Promise<void> {
    for (let current = resolve(path); ; current = resolve(current, '..')) {
      const stat = await lstat(current).catch(() => undefined)
      if (stat?.isSymbolicLink()) throw new WorkspaceError('unsafe_workspace', 'workspace path contains a symlink')
      if (current === this.root) return
    }
  }
  private async ensureRoot(): Promise<void> {
    await this.assertNoSymlinkAncestors(this.root)
    await mkdir(this.root, { recursive: true })
    const stat = await lstat(this.root)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new WorkspaceError('unsafe_workspace', 'workspace root must be a real directory')
  }
  private checked(...parts: string[]): string {
    const path = resolve(this.root, ...parts)
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`))
      throw new WorkspaceError('unsafe_workspace', 'path escapes workspace root')
    return path
  }
  private async assertRealDirectory(path: string): Promise<void> {
    await this.assertNoSymlinkAncestors(path)
    const stat = await lstat(path).catch(() => undefined)
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink())
      throw new WorkspaceError('unsafe_workspace', 'collection path is missing or is a symlink')
  }
  private async atomicJson(path: string, value: JsonObject): Promise<void> {
    const parent = resolve(path, '..')
    await this.assertRealDirectory(parent)
    const existing = await lstat(path).catch(() => undefined)
    if (existing?.isSymbolicLink()) throw new WorkspaceError('unsafe_workspace', 'refusing to replace a symlink')
    const temp = join(parent, `.${basename(path)}.${randomUUID()}.tmp`)
    await writeFile(temp, canonical(value), { encoding: 'utf8', mode: 0o600 })
    await rename(temp, path)
  }
  private async atomicCreateJson(path: string, value: JsonObject): Promise<void> {
    const parent = resolve(path, '..')
    await this.assertRealDirectory(parent)
    const temp = join(parent, `.${basename(path)}.${randomUUID()}.tmp`)
    await writeFile(temp, canonical(value), { encoding: 'utf8', mode: 0o600 })
    try {
      await link(temp, path)
    } catch {
      throw new WorkspaceError('conflict', 'an item already occupies this collection filename')
    } finally {
      await rm(temp, { force: true })
    }
  }
  private async serializeWrite<T>(path: string, work: () => Promise<T>): Promise<T> {
    const previous = CollectionWorkspace.writes.get(path) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const queued = previous.then(() => gate)
    CollectionWorkspace.writes.set(path, queued)
    await previous
    try {
      return await work()
    } finally {
      release()
      if (CollectionWorkspace.writes.get(path) === queued) CollectionWorkspace.writes.delete(path)
    }
  }
  /** Serialized compare-and-replace for this process; external writers must coordinate separately. */
  private async writeSnapshot(path: string, expectedRevision: string, value: JsonObject): Promise<void> {
    await this.serializeWrite(path, async () => {
      const snapshot = await this.readJson(path)
      this.checkRevision(snapshot.revision, expectedRevision)
      await this.atomicJson(path, value)
    })
  }
  private async readJson(path: string): Promise<Revisioned<JsonObject>> {
    const stat = await lstat(path).catch(() => undefined)
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new WorkspaceError('not_found', 'requested item was not found')
    const data = await readFile(path, 'utf8')
    try {
      return { value: object(JSON.parse(data), 'stored file'), revision: revision(data) }
    } catch {
      throw new WorkspaceError('invalid_input', 'stored collection file is not valid JSON')
    }
  }
  private async collectionDir(collectionId: string): Promise<string> {
    await this.ensureRoot()
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === 'environments') continue
      const dir = this.checked(entry.name)
      const file = this.checked(entry.name, 'collection.hakka')
      await this.assertRealDirectory(dir)
      const loaded = await this.readJson(file).catch(() => undefined)
      if (loaded?.value.id === collectionId) return dir
    }
    throw new WorkspaceError('not_found', 'collection was not found')
  }
  private async nodeFile(collection: string, nodeId: string, kind: 'request' | 'folder'): Promise<string> {
    const scan = async (dir: string): Promise<string | undefined> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
          throw new WorkspaceError('unsafe_workspace', 'symlinks are not allowed in collection trees')
        const path = join(dir, entry.name)
        if (
          kind === 'request' &&
          entry.isFile() &&
          entry.name.endsWith('.hakka') &&
          entry.name !== 'collection.hakka' &&
          entry.name !== 'folder.hakka'
        ) {
          const item = await this.readJson(path)
          if (object(item.value.spec, 'request spec').id === nodeId) return path
        }
        if (entry.isDirectory()) {
          const meta = join(path, 'folder.hakka')
          const folder = await this.readJson(meta).catch(() => undefined)
          if (!folder) continue
          if (kind === 'folder' && folder.value.id === nodeId) return meta
          const found = await scan(path)
          if (found) return found
        }
      }
      return undefined
    }
    const found = await scan(collection)
    if (!found) throw new WorkspaceError('not_found', `${kind} was not found`)
    return found
  }
  private checkRevision(current: string, expected?: string): void {
    if (expected && expected !== current)
      throw new WorkspaceError('conflict', 'revision does not match; read the item and retry')
  }

  async listCollections(limit = 50): Promise<Array<{ id: string; name: string; revision: string }>> {
    await this.ensureRoot()
    const result: Array<{ id: string; name: string; revision: string }> = []
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (
        result.length >= Math.min(Math.max(limit, 1), MAX_LIST) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        entry.name === 'environments'
      )
        continue
      const item = await this.readJson(this.checked(entry.name, 'collection.hakka')).catch(() => undefined)
      if (item)
        result.push({
          id: id(item.value.id, 'collection id'),
          name: name(item.value.name, 'collection name'),
          revision: item.revision,
        })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }
  async createCollection(input: { name: string; id?: string; notes?: string | null }): Promise<Revisioned<JsonObject>> {
    return this.serializeWrite(this.root, async () => {
      await this.ensureRoot()
      const collectionName = name(input.name, 'name')
      const collectionId = input.id ? id(input.id, 'id') : randomUUID()
      const directory = this.checked(`${slug(collectionName)}-${collectionId.slice(0, 8)}`)
      await mkdir(directory, { recursive: false })
      await this.assertRealDirectory(directory)
      const value: JsonObject = {
        version: FORMAT_VERSION,
        id: collectionId,
        name: collectionName,
        defaultHeaders: [],
        auth: { none: {} },
        ...(input.notes === undefined || input.notes === null ? {} : { notes: input.notes }),
      }
      try {
        await this.atomicCreateJson(join(directory, 'collection.hakka'), value)
      } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
      return { value, revision: revision(canonical(value)) }
    })
  }
  async readCollection(collectionId: string): Promise<Revisioned<JsonObject>> {
    const item = await this.readJson(
      join(await this.collectionDir(id(collectionId, 'collectionId')), 'collection.hakka'),
    )
    return { value: redact(item.value) as JsonObject, revision: item.revision }
  }
  async deleteCollection(collectionId: string, expectedRevision: string): Promise<void> {
    return this.serializeWrite(this.root, async () => {
      const directory = await this.collectionDir(id(collectionId, 'collectionId'))
      const current = await this.readJson(join(directory, 'collection.hakka'))
      this.checkRevision(current.revision, expectedRevision)
      await rm(directory, { recursive: true })
    })
  }
  async updateCollection(
    collectionId: string,
    patch: { name?: string; notes?: string | null; expectedRevision: string },
  ): Promise<Revisioned<JsonObject>> {
    return this.serializeWrite(this.root, async () => {
      const file = join(await this.collectionDir(id(collectionId, 'collectionId')), 'collection.hakka')
      const current = await this.readJson(file)
      this.checkRevision(current.revision, patch.expectedRevision)
      const value = { ...current.value }
      if (patch.name !== undefined) value.name = name(patch.name, 'name')
      if (patch.notes !== undefined && patch.notes !== null && typeof patch.notes !== 'string')
        throw new WorkspaceError('invalid_input', 'notes must be a string or null')
      if (patch.notes !== undefined) {
        if (patch.notes === null) delete value.notes
        else value.notes = patch.notes
      }
      await this.writeSnapshot(file, current.revision, value)
      return { value, revision: revision(canonical(value)) }
    })
  }
  async createFolder(
    collectionId: string,
    input: { name: string; parentFolderId?: string; id?: string },
  ): Promise<Revisioned<JsonObject>> {
    return this.serializeWrite(this.root, async () => {
      const root = await this.collectionDir(id(collectionId, 'collectionId'))
      const parent = input.parentFolderId
        ? resolve(await this.nodeFile(root, id(input.parentFolderId, 'parentFolderId'), 'folder'), '..')
        : root
      const folderName = name(input.name, 'name')
      const folderId = input.id ? id(input.id, 'id') : randomUUID()
      const directory = join(parent, `${slug(folderName)}-${folderId.slice(0, 8)}`)
      await mkdir(directory, { recursive: false })
      await this.assertRealDirectory(directory)
      const value: JsonObject = {
        seq: await this.nextSeq(parent),
        id: folderId,
        name: folderName,
        headers: [],
        auth: { inherit: {} },
      }
      await this.atomicCreateJson(join(directory, 'folder.hakka'), value)
      return { value, revision: revision(canonical(value)) }
    })
  }
  async readFolder(collectionId: string, folderId: string): Promise<Revisioned<JsonObject>> {
    const item = await this.readJson(
      await this.nodeFile(
        await this.collectionDir(id(collectionId, 'collectionId')),
        id(folderId, 'folderId'),
        'folder',
      ),
    )
    return { value: redact(item.value) as JsonObject, revision: item.revision }
  }
  async updateFolder(
    collectionId: string,
    folderId: string,
    patch: { name?: string; headers?: Json[]; auth?: JsonObject; expectedRevision: string },
  ): Promise<Revisioned<JsonObject>> {
    return this.serializeWrite(this.root, async () => {
      const file = await this.nodeFile(
        await this.collectionDir(id(collectionId, 'collectionId')),
        id(folderId, 'folderId'),
        'folder',
      )
      const current = await this.readJson(file)
      this.checkRevision(current.revision, patch.expectedRevision)
      const value = { ...current.value }
      if (patch.name !== undefined) value.name = name(patch.name, 'name')
      if (patch.headers !== undefined) value.headers = headerPairs(patch.headers, 'headers')
      if (patch.auth !== undefined) value.auth = patch.auth
      await this.writeSnapshot(file, current.revision, value)
      return { value, revision: revision(canonical(value)) }
    })
  }
  async createRequest(
    collectionId: string,
    input: RequestInput & { parentFolderId?: string },
  ): Promise<Revisioned<JsonObject>> {
    return this.serializeWrite(this.root, async () => {
      const root = await this.collectionDir(id(collectionId, 'collectionId'))
      const parent = input.parentFolderId
        ? resolve(await this.nodeFile(root, id(input.parentFolderId, 'parentFolderId'), 'folder'), '..')
        : root
      const spec = this.requestSpec(input)
      const existingID = await this.nodeFile(root, String(spec.id), 'request').catch((error: unknown) => {
        if (error instanceof WorkspaceError && error.code === 'not_found') return undefined
        throw error
      })
      if (existingID) throw new WorkspaceError('conflict', 'a request with this id already exists')
      const value: JsonObject = { seq: await this.nextSeq(parent), spec }
      const file = join(parent, `${slug(spec.name as string)}-${String(spec.id).slice(0, 8)}.hakka`)
      if (await lstat(file).catch(() => undefined))
        throw new WorkspaceError('conflict', 'a request already occupies this collection filename')
      await this.atomicCreateJson(file, value)
      return { value: this.redactRequest(value), revision: revision(canonical(value)) }
    })
  }
  async readRequest(collectionId: string, requestId: string): Promise<Revisioned<JsonObject>> {
    const item = await this.readJson(
      await this.nodeFile(
        await this.collectionDir(id(collectionId, 'collectionId')),
        id(requestId, 'requestId'),
        'request',
      ),
    )
    return { value: this.redactRequest(item.value), revision: item.revision }
  }
  async updateRequest(
    collectionId: string,
    requestId: string,
    patch: RequestInput & { expectedRevision: string },
  ): Promise<Revisioned<JsonObject>> {
    return this.serializeWrite(this.root, async () => {
      const file = await this.nodeFile(
        await this.collectionDir(id(collectionId, 'collectionId')),
        id(requestId, 'requestId'),
        'request',
      )
      const current = await this.readJson(file)
      this.checkRevision(current.revision, patch.expectedRevision)
      const old = object(current.value.spec, 'request spec')
      const spec = this.requestSpec({ ...old, ...patch, id: old.id as string })
      const value: JsonObject = { ...current.value, spec }
      await this.writeSnapshot(file, current.revision, value)
      return { value: this.redactRequest(value), revision: revision(canonical(value)) }
    })
  }
  async deleteNode(collectionId: string, nodeId: string, expectedRevision: string): Promise<void> {
    return this.serializeWrite(this.root, async () => {
      const root = await this.collectionDir(id(collectionId, 'collectionId'))
      for (const kind of ['request', 'folder'] as const) {
        try {
          const file = await this.nodeFile(root, id(nodeId, 'nodeId'), kind)
          const current = await this.readJson(file)
          this.checkRevision(current.revision, expectedRevision)
          await rm(kind === 'folder' ? resolve(file, '..') : file, { recursive: kind === 'folder', force: false })
          return
        } catch (error) {
          if (!(error instanceof WorkspaceError) || error.code !== 'not_found' || kind === 'folder') throw error
        }
      }
    })
  }
  async listEnvironments(
    collectionId: string,
    limit = 50,
  ): Promise<Array<{ id: string; name: string; revision: string }>> {
    const dir = await this.environmentDir(await this.collectionDir(id(collectionId, 'collectionId')))
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const result = [] as Array<{ id: string; name: string; revision: string }>
    for (const entry of entries) {
      if (
        result.length >= Math.min(Math.max(limit, 1), MAX_LIST) ||
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !entry.name.endsWith('.hakka')
      )
        continue
      const item = await this.readJson(join(dir, entry.name)).catch(() => undefined)
      if (item)
        result.push({
          id: id(item.value.id, 'environment id'),
          name: name(item.value.name, 'environment name'),
          revision: item.revision,
        })
    }
    return result
  }
  async createEnvironment(
    collectionId: string,
    input: { id?: string; name: string; variables?: EnvironmentVariableInput[] },
  ): Promise<Revisioned<JsonObject>> {
    return this.serializeWrite(this.root, async () => {
      const dir = await this.environmentDir(await this.collectionDir(id(collectionId, 'collectionId')))
      await mkdir(dir, { recursive: true })
      await this.assertRealDirectory(dir)
      const value: JsonObject = {
        id: input.id ? id(input.id, 'id') : randomUUID(),
        name: name(input.name, 'name'),
        variables: this.variables(input.variables ?? []),
      }
      const file = join(dir, `${slug(value.name as string)}-${String(value.id).slice(0, 8)}.hakka`)
      await this.atomicCreateJson(file, value)
      return { value: this.redactEnvironment(value), revision: revision(canonical(value)) }
    })
  }
  async readEnvironment(collectionId: string, environmentId: string): Promise<Revisioned<JsonObject>> {
    const item = await this.environmentFile(
      await this.collectionDir(id(collectionId, 'collectionId')),
      id(environmentId, 'environmentId'),
    )
    return { value: this.redactEnvironment(item.value), revision: item.revision }
  }
  async updateEnvironment(
    collectionId: string,
    environmentId: string,
    patch: { name?: string; variables?: EnvironmentVariableInput[]; expectedRevision: string },
  ): Promise<Revisioned<JsonObject>> {
    return this.serializeWrite(this.root, async () => {
      const item = await this.environmentFile(
        await this.collectionDir(id(collectionId, 'collectionId')),
        id(environmentId, 'environmentId'),
      )
      this.checkRevision(item.revision, patch.expectedRevision)
      const value = { ...item.value }
      if (patch.name !== undefined) value.name = name(patch.name, 'name')
      if (patch.variables !== undefined) value.variables = this.variables(patch.variables)
      await this.writeSnapshot(item.path, item.revision, value)
      return { value: this.redactEnvironment(value), revision: revision(canonical(value)) }
    })
  }
  async deleteEnvironment(collectionId: string, environmentId: string, expectedRevision: string): Promise<void> {
    return this.serializeWrite(this.root, async () => {
      const item = await this.environmentFile(
        await this.collectionDir(id(collectionId, 'collectionId')),
        id(environmentId, 'environmentId'),
      )
      this.checkRevision(item.revision, expectedRevision)
      await rm(item.path)
    })
  }
  private async environmentDir(collection: string): Promise<string> {
    const dir = this.checked('environments', basename(collection))
    const parent = resolve(dir, '..')
    await this.assertNoSymlinkAncestors(parent)
    await mkdir(parent, { recursive: true })
    await this.assertRealDirectory(parent)
    const existing = await lstat(dir).catch(() => undefined)
    if (existing?.isSymbolicLink())
      throw new WorkspaceError('unsafe_workspace', 'environment directory must not be a symlink')
    return dir
  }
  private async environmentFile(
    collection: string,
    environmentId: string,
  ): Promise<Revisioned<JsonObject> & { path: string }> {
    const dir = await this.environmentDir(collection)
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => []))
      if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.hakka')) {
        const item = await this.readJson(join(dir, entry.name))
        if (item.value.id === environmentId) return { ...item, path: join(dir, entry.name) }
      }
    throw new WorkspaceError('not_found', 'environment was not found')
  }
  private async nextSeq(dir: string): Promise<number> {
    let max = -1
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new WorkspaceError('unsafe_workspace', 'symlinks are not allowed in collection trees')
      const file = entry.isDirectory() ? join(dir, entry.name, 'folder.hakka') : join(dir, entry.name)
      const item = await this.readJson(file).catch(() => undefined)
      if (item && typeof item.value.seq === 'number') max = Math.max(max, item.value.seq)
    }
    return max + 1
  }
  private requestSpec(input: RequestInput): JsonObject {
    const method = (input.method ?? 'GET').toUpperCase()
    if (!/^[A-Z]+$/.test(method)) throw new WorkspaceError('invalid_input', 'method must be an HTTP token')
    const spec: JsonObject = {
      id: input.id ? id(input.id, 'id') : randomUUID(),
      name: name(input.name, 'name'),
      method,
      url: string(input.url ?? '', 'url', true),
      headers: headerPairs(input.headers, 'headers'),
      query: headerPairs(input.query, 'query'),
      body: input.body ?? { none: {} },
      auth: input.auth ?? { inherit: {} },
      assertions: input.assertions ?? [],
      captures: input.captures ?? [],
      ...(input.notes === undefined || input.notes === null ? {} : { notes: input.notes }),
      ...(input.timeout === undefined || input.timeout === null ? {} : { timeout: input.timeout }),
      followRedirects: input.followRedirects ?? true,
    }
    if (input.scripts != null) spec.scripts = input.scripts
    if (input.session != null) {
      const session = object(input.session, 'session')
      const variants = Number(session.webSocket != null) + Number(session.sse != null)
      if (variants !== 1)
        throw new WorkspaceError('invalid_input', 'session must contain exactly one webSocket or sse variant')
      spec.session = session
    }
    return spec
  }
  private variables(variables: EnvironmentVariableInput[]): Json[] {
    if (!Array.isArray(variables) || variables.length > MAX_LIST)
      throw new WorkspaceError('invalid_input', 'variables must contain at most 100 items')
    const seen = new Set<string>()
    return variables.map((variable) => {
      const variableName = name(variable.name, 'variable name')
      if (seen.has(variableName)) throw new WorkspaceError('invalid_input', 'environment variable names must be unique')
      seen.add(variableName)
      const secret = variable.secret === true
      if (secret || variable.secretRef !== undefined)
        throw new WorkspaceError(
          'invalid_input',
          'secret environment authoring requires a desktop Keychain binding and is not supported by MCP',
        )
      return {
        id: variable.id ? id(variable.id, 'variable id') : randomUUID(),
        name: variableName,
        value: secret ? SECRET_REFERENCE : string(variable.value ?? '', 'variable value', true),
        secret,
        enabled: variable.enabled !== false,
      }
    })
  }
  private redactRequest(value: JsonObject): JsonObject {
    return redact(value) as JsonObject
  }
  private redactEnvironment(value: JsonObject): JsonObject {
    const out = structuredClone(value)
    if (Array.isArray(out.variables))
      for (const raw of out.variables) {
        const variable = object(raw, 'variable')
        if (variable.secret === true) {
          variable.value = '[redacted]'
          variable.secretRef = 'keychain-reference'
        }
      }
    return out
  }
}
