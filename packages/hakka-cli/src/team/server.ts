import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { allows } from './store.js'
import type { TeamStore } from './store.js'
import type { Principal, Role } from './types.js'

const LIMIT = 2 * 1024 * 1024
export interface TeamServer {
  listen(port: number, host: string): Promise<{ port: number }>
  close(): Promise<void>
}
export function createTeamServer(store: TeamStore): TeamServer {
  const server = createServer(
    (req, res) => void handle(store, req, res).catch(() => fail(res, 400, 'invalid_request', 'Invalid request')),
  )
  return {
    listen: (port, host) =>
      new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          resolve({ port: (server.address() as { port: number }).port })
        })
      }),
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}
async function handle(store: TeamStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/healthz') return json(res, 200, { data: { status: 'ready' } })
    const principal = store.authenticate(bearer(req))
    if (!principal) return fail(res, 401, 'unauthorized', 'A bearer token is required')
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments[0] !== 'api' || segments[1] !== 'v1') return fail(res, 404, 'not_found', 'Resource not found')
    if (segments[2] === 'tokens' && req.method === 'POST') {
      if (!allows(principal.role, 'admin')) return fail(res, 403, 'forbidden', 'Admin role required')
      const body = await bodyJson(req)
      const memberId = string(body.memberId)
      const role = string(body.role) as Role
      if (!memberId || !['read', 'write', 'admin'].includes(role))
        return fail(res, 422, 'validation_error', 'memberId and role are required')
      return json(res, 201, { data: await store.issueToken(memberId, role) })
    }
    if (segments[2] === 'tokens' && segments[3] && req.method === 'DELETE') {
      if (!allows(principal.role, 'admin')) return fail(res, 403, 'forbidden', 'Admin role required')
      return (await store.revokeToken(decodeURIComponent(segments[3])))
        ? json(res, 204, undefined)
        : fail(res, 404, 'not_found', 'Token not found')
    }
    if (segments[2] === 'collections' && segments[3])
      return await collection(store, principal, decodeURIComponent(segments[3]), req, res)
    if (segments[2] === 'monitors') return await monitors(store, principal, segments[3], req, res)
    if (segments[2] === 'secrets' && segments[3] && req.method === 'PUT') {
      if (!allows(principal.role, 'admin')) return fail(res, 403, 'forbidden', 'Admin role required')
      const body = await bodyJson(req)
      const value = typeof body.value === 'string' && body.value.length <= 32_768 ? body.value : undefined
      if (!value) return fail(res, 422, 'validation_error', 'value is required')
      await store.putSecret(decodeURIComponent(segments[3]), value)
      return json(res, 204, undefined)
    }
    return fail(res, 404, 'not_found', 'Resource not found')
  } catch (error: unknown) {
    return fail(res, 400, 'invalid_request', error instanceof Error ? error.message : 'Invalid request')
  }
}
async function collection(
  store: TeamStore,
  principal: Principal,
  id: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === 'GET') {
    if (!allows(principal.role, 'read')) return fail(res, 403, 'forbidden', 'Read role required')
    const snapshot = store.getCollection(id)
    return snapshot ? json(res, 200, { data: snapshot }) : fail(res, 404, 'not_found', 'Collection not found')
  }
  if (req.method === 'PUT') {
    if (!allows(principal.role, 'write')) return fail(res, 403, 'forbidden', 'Write role required')
    const input = await bodyJson(req)
    const result = await store.putCollection(id, object(input.files), number(input.revision), principal.memberId)
    return result === 'conflict'
      ? fail(res, 409, 'revision_conflict', 'Fetch the current revision before replacing this collection')
      : json(res, 200, { data: result })
  }
  return fail(res, 405, 'method_not_allowed', 'Method not allowed')
}
async function monitors(
  store: TeamStore,
  principal: Principal,
  id: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!allows(principal.role, id && req.method === 'GET' ? 'read' : 'admin'))
    return fail(res, 403, 'forbidden', 'Required role missing')
  if (!id && req.method === 'GET') return json(res, 200, { data: store.listMonitors() })
  if (id && req.method === 'GET')
    return json(res, 200, { data: { monitor: store.getMonitor(id), runs: store.runs(id) } })
  if (!id && req.method === 'POST') {
    const body = await bodyJson(req)
    const monitor = await store.putMonitor({
      collectionId: string(body.collectionId) ?? '',
      intervalMs: number(body.intervalMs) ?? 0,
      enabled: body.enabled !== false,
      webhook: typeof body.webhook === 'string' ? body.webhook : undefined,
      secretRefs: Array.isArray(body.secretRefs)
        ? body.secretRefs.filter((v): v is string => typeof v === 'string')
        : [],
    })
    return json(res, 201, { data: monitor })
  }
  return fail(res, 405, 'method_not_allowed', 'Method not allowed')
}
function bearer(req: IncomingMessage): string | undefined {
  const value = req.headers.authorization
  return value?.startsWith('Bearer ') ? value.slice(7) : undefined
}
async function bodyJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (Buffer.byteLength(text) > LIMIT) throw new Error('Request body exceeds 2 MiB')
  }
  const value: unknown = JSON.parse(text || '{}')
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('JSON object required')
  return value as Record<string, unknown>
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value))
}
function fail(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message } })
}
function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 128 ? value : undefined
}
function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}
function object(value: unknown): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('files must be an object')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.some((entry) => typeof entry[1] !== 'string')) throw new Error('file contents must be strings')
  return Object.fromEntries(entries) as Record<string, string>
}
