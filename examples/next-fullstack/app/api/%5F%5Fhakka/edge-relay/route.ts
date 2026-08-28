import { createBridgeClient, type BridgeClient, type NetworkRequest } from 'hakka-node'

/**
 * Same-origin, dev-only relay for Edge-runtime captures. `startEdgeCapture`
 * (hakka-node/next's Edge branch, `packages/hakka-node/src/next/edgeCapture.ts`)
 * has no embedded bridge — the Edge sandbox can't use `ws`/`node:crypto` — so
 * `instrumentation.ts`'s `sink` posts every `runtime: 'edge'` record here
 * instead, and this plain Node-runtime route hands it to the SAME bridge hub
 * the server capture already streams into (`ws://localhost:8989`), via its
 * own send-only client. One extra peer on the same hub, nothing more — see
 * `README.md`'s "Two peers, one hub" for the client/server pair this extends
 * to three.
 *
 * Gated the same way `hakka-node/next`'s edge `register()` gates capture
 * itself (dev only, unless forced) — this route 404s outside that, so it
 * carries no reachable surface in a production build even if something
 * mis-imports it.
 *
 * `handleControl: false` — the server capture in `instrumentation.ts` already
 * has its own bridge client applying control frames (mock/breakpoint/throttle)
 * to this process's engine singletons; a second client in the same process
 * doing the same thing would apply every command twice for no benefit. This
 * client only ever sends.
 */
let client: BridgeClient | null = null

function bridgeClient(): BridgeClient {
  client ??= createBridgeClient({ handleControl: false })
  return client
}

function isNetworkRequestShape(value: unknown): value is NetworkRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.url === 'string' && typeof v.method === 'string'
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') return new Response('Not Found', { status: 404 })

  const body: unknown = await request.json().catch(() => null)
  if (!isNetworkRequestShape(body)) return new Response('Bad Request', { status: 400 })

  bridgeClient().send(body)
  return new Response(null, { status: 202 })
}
