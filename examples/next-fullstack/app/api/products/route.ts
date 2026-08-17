import { runInTraceContext } from 'hakka-node'
import { NextResponse } from 'next/server'

/**
 * Route Handler (runs on the server). The client calls this; this then makes its
 * own server-side outbound fetch. In the Hakka overlay you'll see BOTH: the
 * browser's call to `/api/products` (runtime: client) and this downstream call to
 * the upstream API (runtime: server) — one user action, the full chain.
 *
 * Production cohort capture demo (`HAKKA_PROD_CAPTURE=1`, ADR 0002 — see
 * `instrumentation.prod.ts` and `packages/hakka-node/README.md#production-capture-for-a-debug-cohort-hakka-nodeprod`):
 * a request carrying `x-debug-cohort: 1` runs inside a `debug: true` trace
 * context, the only gate `hakka-node/prod`'s capture checks. This example has no
 * auth, so the header stands in for a real allowlist check. Wrapped here at the
 * route-handler level rather than in `middleware.ts` — Next middleware runs on
 * the Edge runtime by default, and `runInTraceContext` needs Node's
 * AsyncLocalStorage (`hakka-node/prod` is Node-only), so it wouldn't apply there.
 * With the flag unset (the default), this is a no-op: `cohort` is always `false`
 * and `fetchProducts()` runs exactly as before.
 */
export async function GET(request: Request) {
  const cohort = process.env.HAKKA_PROD_CAPTURE === '1' && request.headers.get('x-debug-cohort') === '1'
  if (!cohort) return fetchProducts()
  return runInTraceContext({ traceId: crypto.randomUUID(), debug: true }, fetchProducts)
}

async function fetchProducts() {
  const upstream = await fetch('https://jsonplaceholder.typicode.com/users?_limit=3', {
    headers: { accept: 'application/json' },
  })
  const users = (await upstream.json()) as Array<{ id: number; name: string; email: string }>
  return NextResponse.json({ products: users.map((u) => ({ id: u.id, name: u.name, email: u.email })) })
}
