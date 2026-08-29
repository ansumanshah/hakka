/**
 * Compiles the routes these tests touch BEFORE any test's own timeout starts.
 *
 * `next dev` (Turbopack) answers the port as soon as it boots but compiles each route on first
 * request, so with a cold `.next/` the first `page.goto('/')` in the run pays several seconds of
 * compilation inside a 30s test timeout — and the app-router page, its client chunk and the
 * `/api/products` route handler each compile separately. Observed cold, before this existed: four
 * of five tests failed, every one of them looking like a product bug (overlay "never mounts",
 * server row "never captured") when the only real problem was that the route was still building.
 *
 * Warming here rather than raising the timeouts keeps the timeouts meaningful: a test that now
 * exceeds 30s is a real hang, not a build.
 */
const PORT = 3000

async function warm(path: string): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${PORT}${path}`)
    // Drain the body so the route handler runs to completion (and, for `/`, so its own
    // server-side fetch actually fires) rather than being abandoned mid-stream.
    await res.text()
  } catch {
    // A warmup miss is not a test failure — the tests themselves still assert everything that
    // matters, and swallowing this keeps a transient boot race from failing the whole run
    // before a single test has executed.
  }
}

export default async function globalSetup(): Promise<void> {
  await warm('/')
  await warm('/api/products')
}
