/**
 * Production cohort capture — ADR 0002 (`packages/hakka-node/README.md#production-capture-for-a-debug-cohort-hakka-nodeprod`).
 * Demo-only wiring, entirely behind `HAKKA_PROD_CAPTURE=1`; the default example
 * (`HAKKA_PROD_CAPTURE` unset) never imports this file — see `instrumentation.ts`.
 *
 * Node-only, like `hakka-node/prod` itself (AsyncLocalStorage + `node:crypto` +
 * `node:http`/`node:https`). Only ever reached via a dynamic `import()` gated on
 * `NEXT_RUNTIME === 'nodejs'`, so it's never pulled into an Edge bundle.
 *
 * `startProdCapture` is idempotent — a second call while capture is already
 * active just returns the first call's handle and ignores the new options — so
 * `getProdCapture()` here doubles as both "start it" (called once from
 * `instrumentation.ts` at server boot) and "get the running handle" (called from
 * `app/api/__hakka/pull/route.ts` to hand to `createPullHandler`).
 */
import { startProdCapture, type ProdCaptureHandle } from 'hakka-node/prod'

/**
 * jsonplaceholder is the only outbound call this example's route handlers make
 * that's worth demoing a cohort capture against — see `app/api/products/route.ts`.
 */
const CAPTURE_URLS = ['https://jsonplaceholder.typicode.com/*']

export function getProdCapture(): ProdCaptureHandle {
  return startProdCapture({ captureUrls: CAPTURE_URLS })
}
