/**
 * Dev capture embeds the bridge; HAKKA_DESKTOP=1 uses the desktop hub instead.
 * Register OTel before Hakka and pass hakkaSpanProcessor at provider construction.
 * Node-only imports stay behind NEXT_RUNTIME to keep them out of Edge bundles.
 * Edge records relay to the Node route; ignore that relay to prevent a capture loop.
 * Production cohort setup lives in instrumentation.prod.ts (HAKKA_PROD_CAPTURE=1).
 */
import { registerOTel } from '@vercel/otel'
import { register as hakkaRegister } from 'hakka-node/next'
import type { NetworkRequest } from 'hakka-node/next'

/**
 * A caller-supplied `ignorePatterns` REPLACES (not extends) hakka-node's own
 * `*telemetry.nextjs.org*` default (see `next/serverCapture.ts`'s
 * `DEFAULT_IGNORE_PATTERNS` doc comment) — both patterns have to live in the
 * one array passed to `hakkaRegister` below, or the telemetry noise filter
 * silently disappears. The second entry stops `relayEdgeCapture`'s own POST
 * from being captured and relayed right back to itself.
 */
const IGNORE_PATTERNS = ['*telemetry.nextjs.org*', '*/api/__hakka/edge-relay*']

function relayEdgeCapture(req: NetworkRequest): void {
  if (req.runtime !== 'edge') return
  // Dev-only file, same localhost assumption `DEFAULT_BRIDGE_URL`
  // (`ws://localhost:8989`) already makes.
  void fetch('http://localhost:3000/api/__hakka/edge-relay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  }).catch(() => {})
}

export async function register(): Promise<void> {
  const spanProcessors =
    process.env.NEXT_RUNTIME === 'nodejs' ? [(await import('hakka-node')).hakkaSpanProcessor()] : []
  registerOTel({ serviceName: 'hakka-next-fullstack-example', spanProcessors })
  await hakkaRegister({
    undiciTiming: true,
    traceSpans: true,
    // See the `HAKKA_DESKTOP` doc comment above.
    embedBridge: process.env.HAKKA_DESKTOP !== '1',
    ignorePatterns: IGNORE_PATTERNS,
    sink: relayEdgeCapture,
  })

  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NODE_ENV === 'production' &&
    process.env.HAKKA_PROD_CAPTURE === '1'
  ) {
    const { getProdCapture } = await import('./instrumentation.prod')
    getProdCapture()
  }
}
