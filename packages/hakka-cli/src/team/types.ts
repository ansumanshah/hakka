export type Role = 'admin' | 'write' | 'read'

interface TeamMember {
  id: string
  role: Role
}
interface TeamToken {
  id: string
  hash: string
  role: Role
  memberId: string
  createdAt: string
}
export interface CollectionSnapshot {
  id: string
  revision: number
  files: Record<string, string>
  updatedAt: string
  updatedBy: string
}
export interface Monitor {
  id: string
  collectionId: string
  intervalMs: number
  enabled: boolean
  webhook?: string
  secretRefs: string[]
  /** Immutable approved source for secret-bearing execution. */
  pinnedFiles?: Record<string, string>
  pinnedRevision?: number
  nextRunAt: number
  running?: boolean
}
export interface MonitorRun {
  id: string
  monitorId: string
  startedAt: string
  completedAt: string
  outcome: 'passed' | 'failed' | 'error'
  summary: { passed: number; failed: number; durationMs: number }
  error?: string
}
export interface TeamState {
  version: 1
  members: TeamMember[]
  tokens: TeamToken[]
  collections: Record<string, CollectionSnapshot>
  monitors: Record<string, Monitor>
  runs: MonitorRun[]
  secrets: Record<string, string>
}
export interface Principal {
  memberId: string
  role: Role
}
