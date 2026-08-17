import { createPullHandler } from 'hakka-node/prod'

import { getProdCapture } from '../../../../instrumentation.prod'

/**
 * Same-origin, authed pull route for ADR 0002's production cohort capture
 * (`HAKKA_PROD_CAPTURE=1` — see `instrumentation.prod.ts` and
 * `packages/hakka-node/README.md#production-capture-for-a-debug-cohort-hakka-nodeprod`).
 * `createPullHandler` 401s without a valid `Authorization: Bearer <HAKKA_PULL_TOKEN>`
 * header (constant-time compare) and supports `?since=`/`?user=` filters.
 *
 * `getProdCapture()` is `startProdCapture` under the hood, which is idempotent —
 * this returns the SAME handle `instrumentation.ts` started at boot, it does not
 * start a second capture. With the flag unset (or outside production — same gate
 * `instrumentation.ts` uses to start capture in the first place) this route 404s
 * instead of ever touching `hakka-node/prod`, matching "gate everything behind
 * the flag."
 */
const enabled = process.env.HAKKA_PROD_CAPTURE === '1' && process.env.NODE_ENV === 'production'
const handler = enabled
  ? createPullHandler({ capture: getProdCapture(), token: process.env.HAKKA_PULL_TOKEN ?? '' })
  : null

export async function GET(request: Request): Promise<Response> {
  if (!handler) return new Response('Not Found', { status: 404 })
  return handler(request)
}
