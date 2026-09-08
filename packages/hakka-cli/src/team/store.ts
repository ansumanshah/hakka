import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { CollectionSnapshot, Monitor, MonitorRun, Principal, Role, TeamState } from './types.js'

const MAX_FILE_BYTES = 512 * 1024
const MAX_FILES = 512
const empty = (): TeamState => ({
  version: 1,
  members: [],
  tokens: [],
  collections: {},
  monitors: {},
  runs: [],
  secrets: {},
})
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const createToken = () => `hakka_team_${randomBytes(24).toString('base64url')}`
export function allows(role: Role, needed: Role): boolean {
  return { read: 0, write: 1, admin: 2 }[role] >= { read: 0, write: 1, admin: 2 }[needed]
}

export class TeamStore {
  private state: TeamState = empty()
  private writing = Promise.resolve()
  readonly path: string
  constructor(path: string) {
    this.path = resolve(path)
  }
  async open(): Promise<void> {
    try {
      this.state = JSON.parse(await readFile(this.path, 'utf8')) as TeamState
      let recovered = false
      for (const monitor of Object.values(this.state.monitors))
        if (monitor.running) {
          monitor.running = false
          monitor.nextRunAt = Date.now()
          recovered = true
        }
      if (recovered) await this.persist()
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.persist()
    }
  }
  async bootstrap(token: string): Promise<boolean> {
    if (!this.state.tokens.length) {
      this.state.members.push({ id: 'bootstrap', role: 'admin' })
      this.state.tokens.push({
        id: randomUUID(),
        hash: hash(token),
        role: 'admin',
        memberId: 'bootstrap',
        createdAt: new Date().toISOString(),
      })
      await this.persist()
      return true
    }
    return false
  }
  authenticate(token: string | undefined): Principal | undefined {
    if (!token) return
    const digest = hash(token)
    const found = this.state.tokens.find((candidate) =>
      timingSafeEqual(Buffer.from(candidate.hash), Buffer.from(digest)),
    )
    return found && { memberId: found.memberId, role: found.role }
  }
  async issueToken(memberId: string, role: Role): Promise<{ token: string; id: string }> {
    const token = createToken()
    const id = randomUUID()
    this.state.members = [...this.state.members.filter((m) => m.id !== memberId), { id: memberId, role }]
    this.state.tokens.push({ id, hash: hash(token), role, memberId, createdAt: new Date().toISOString() })
    await this.persist()
    return { token, id }
  }
  async revokeToken(id: string): Promise<boolean> {
    const before = this.state.tokens.length
    this.state.tokens = this.state.tokens.filter((token) => token.id !== id)
    if (before === this.state.tokens.length) return false
    await this.persist()
    return true
  }
  getCollection(id: string): CollectionSnapshot | undefined {
    return this.state.collections[id]
  }
  async putCollection(
    id: string,
    files: Record<string, string>,
    revision: number | undefined,
    by: string,
  ): Promise<CollectionSnapshot | 'conflict'> {
    if (!validId(id) || !validFiles(files)) throw new Error('invalid collection snapshot')
    const current = this.state.collections[id]
    if (current && revision !== current.revision) return 'conflict'
    const snapshot = {
      id,
      revision: (current?.revision ?? 0) + 1,
      files,
      updatedAt: new Date().toISOString(),
      updatedBy: by,
    }
    this.state.collections[id] = snapshot
    await this.persist()
    return snapshot
  }
  listMonitors(): Monitor[] {
    return Object.values(this.state.monitors)
  }
  getMonitor(id: string): Monitor | undefined {
    return this.state.monitors[id]
  }
  async putMonitor(
    input: Omit<Monitor, 'id' | 'nextRunAt' | 'running'> & { id?: string; nextRunAt?: number; running?: boolean },
  ): Promise<Monitor> {
    if (
      !validId(input.collectionId) ||
      !Number.isInteger(input.intervalMs) ||
      input.intervalMs < 1_000 ||
      input.intervalMs > 30 * 86_400_000
    )
      throw new Error('invalid monitor')
    const id = input.id ?? randomUUID()
    const current = this.state.monitors[id]
    const snapshot = this.state.collections[input.collectionId]
    if (input.secretRefs.length && !snapshot) throw new Error('secret monitor requires an existing collection')
    const monitor: Monitor = {
      ...input,
      id,
      nextRunAt: input.nextRunAt ?? Date.now() + input.intervalMs,
      running: input.running,
      pinnedFiles: input.secretRefs.length
        ? (input.pinnedFiles ?? current?.pinnedFiles ?? structuredClone(snapshot!.files))
        : input.pinnedFiles,
      pinnedRevision: input.secretRefs.length
        ? (input.pinnedRevision ?? current?.pinnedRevision ?? snapshot!.revision)
        : input.pinnedRevision,
    }
    this.state.monitors[id] = monitor
    await this.persist()
    return monitor
  }
  async setRunning(id: string, running: boolean): Promise<void> {
    const monitor = this.state.monitors[id]
    if (!monitor) return
    monitor.running = running
    await this.persist()
  }
  async appendRun(run: MonitorRun): Promise<void> {
    this.state.runs = [run, ...this.state.runs].slice(0, 1000)
    await this.persist()
  }
  runs(id: string): MonitorRun[] {
    return this.state.runs.filter((run) => run.monitorId === id)
  }
  secrets(refs: string[]): Record<string, string> {
    return Object.fromEntries(
      refs.flatMap((ref) => (this.state.secrets[ref] == null ? [] : [[ref, this.state.secrets[ref]]])),
    )
  }
  async putSecret(ref: string, value: string): Promise<void> {
    if (!validId(ref) || value.length > 32_768) throw new Error('invalid secret')
    this.state.secrets[ref] = value
    await this.persist()
  }
  private async persist(): Promise<void> {
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const temp = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(this.state), { mode: 0o600 })
      await rename(temp, this.path)
    })
    return this.writing
  }
}
function validId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)
}
function validFiles(files: Record<string, string>): boolean {
  const entries = Object.entries(files)
  return (
    entries.length <= MAX_FILES &&
    entries.every(
      ([path, value]) =>
        validSnapshotPath(path) &&
        path.length < 240 &&
        !path.startsWith('/') &&
        !path.split('/').includes('..') &&
        (path.endsWith('.hakka') || path.endsWith('.json')) &&
        typeof value === 'string' &&
        Buffer.byteLength(value) <= MAX_FILE_BYTES,
    )
  )
}

function validSnapshotPath(path: string): boolean {
  const parts = path.split('/')
  return (
    path !== '.hakka/team-sync.json' &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
  )
}
