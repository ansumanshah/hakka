/**
 * Dev capture embeds the bridge; HAKKA_DESKTOP=1 uses the desktop hub instead.
 * Register OTel before Hakka and pass hakkaSpanProcessor at provider construction.
 * Node-only imports stay behind NEXT_RUNTIME to keep them out of Edge bundles.
 * Edge records relay through app/api/%5F%5Fhakka/edge-relay (hakka-node/next sends, the route receives).
 * Production cohort setup lives in instrumentation.prod.ts (HAKKA_PROD_CAPTURE=1).
 */
import { registerOTel } from '@vercel/otel'
import { register as hakkaRegister } from 'hakka-node/next'

export async function register(): Promise<void> {
  const spanProcessors =
    process.env.NEXT_RUNTIME === 'nodejs' ? [(await import('hakka-node')).hakkaSpanProcessor()] : []
  registerOTel({ serviceName: 'hakka-next-fullstack-example', spanProcessors })
  await hakkaRegister({
    undiciTiming: true,
    traceSpans: true,
    // Keep a dev server separate from the desktop app or another local Next
    // instance with HAKKA_BRIDGE_URL=ws://localhost:<port>. The matching
    // NEXT_PUBLIC_HAKKA_BRIDGE_URL value points the browser overlay here.
    bridgeUrl: process.env.HAKKA_BRIDGE_URL,
    // See the `HAKKA_DESKTOP` doc comment above.
    embedBridge: process.env.HAKKA_DESKTOP !== '1',
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
