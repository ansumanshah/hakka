export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type ObjectJson = Record<string, Json>

export interface Header {
  name: string
  value: string
  enabled?: boolean
}
export interface RequestSpec {
  id: string
  name: string
  method: string
  url: string
  headers?: Header[]
  query?: Header[]
  body?: ObjectJson
  auth?: ObjectJson
  assertions?: ObjectJson[]
  captures?: ObjectJson[]
  timeout?: number
  followRedirects?: boolean
  scripts?: ObjectJson
  session?: {
    webSocket?: { sendFrames: Array<{ data: string; isBinary: boolean }>; maxFrames: number; timeoutMs: number }
    sse?: { maxEvents: number; timeoutMs: number }
  }
}
export interface Collection {
  id: string
  name: string
  defaultHeaders?: Header[]
  auth?: ObjectJson
}
export interface RunItem {
  name: string
  id: string
  status?: number
  durationMs: number
  outcome: 'passed' | 'failed' | 'error'
  assertions: string[]
  error?: string
}
export interface RunReport {
  collection: string
  startedAt: string
  durationMs: number
  iterations: number
  passed: number
  failed: number
  items: RunItem[]
}

export interface RunOptions {
  environment?: Record<string, string>
  folder?: string
  dataFile?: string
  repeat?: number
  delayMs?: number
  timeoutMs?: number
  jsonReport?: string
  junitReport?: string
  json?: boolean
  /** Cancels the entire run, including hooks, authentication, transports, and iteration delays. */
  signal?: AbortSignal
  /** Local CLI runs hooks by default; server callers must opt in explicitly. */
  allowScripts?: boolean
}

export interface LoadedRequest {
  request: RequestSpec
  headers: Header[]
  auth: ObjectJson
  path: string
  root: string
}
