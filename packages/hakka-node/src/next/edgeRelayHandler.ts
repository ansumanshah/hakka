/**
 * Edge relay, Node side. A Route Handler that receives the records
 * `createEdgeRelaySink` POSTs from the Edge runtime and hands them to the
 * bridge hub the server capture already streams into.
 *
 *   // app/api/%5F%5Fhakka/edge-relay/route.ts
 *   import { createEdgeRelayHandler } from 'hakka-node/next/server'
 *   export const POST = createEdgeRelayHandler()
 */
import type { NetworkRequest } from 'hakka-core'

import { createBridgeClient, type BridgeClient } from '../bridgeClient'

export interface EdgeRelayHandlerOptions {
  /** Hub to forward to. Default: the same `ws://localhost:8989` the server capture uses. Match `register({ bridgeUrl })`. */
  bridgeUrl?: string
  /** Serve in production too (default false: the route answers 404 there). */
  force?: boolean
}

function isNetworkRequestShape(value: unknown): value is NetworkRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.url === 'string' && typeof v.method === 'string'
}

export function createEdgeRelayHandler(options: EdgeRelayHandlerOptions = {}): (request: Request) => Promise<Response> {
  let client: BridgeClient | null = null
  // Send-only: the server capture's own client already applies control frames
  // (mock, breakpoint, throttle) to this process, and a second one would apply
  // each command twice.
  const bridge = (): BridgeClient => (client ??= createBridgeClient({ url: options.bridgeUrl, handleControl: false }))

  return async (request) => {
    if (process.env.NODE_ENV === 'production' && !options.force) return new Response('Not Found', { status: 404 })
    const body: unknown = await request.json().catch(() => null)
    if (!isNetworkRequestShape(body)) return new Response('Bad Request', { status: 400 })
    bridge().send(body)
    return new Response(null, { status: 202 })
  }
}
