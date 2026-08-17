'use server'

/**
 * A Server Action — exercises the `requestKind: 'server-action'` case
 * (hakka-node's `spanProcessor.ts`) alongside the Server Component
 * (`document`), the client → route handler round trip
 * (`route-handler`), and RSC navigations. Next's action dispatch carries a
 * `next-action` header on the inbound POST, which `trace.ts`'s
 * `parseRequestKindHint` reads — this is the live case that verifies that
 * header actually survives to the read point (flagged as unverified in the
 * design doc).
 */
export async function pingServerAction(): Promise<{ ok: true; at: string }> {
  // A server-side outbound fetch inside the action, so its trace has a
  // child hop too (same as the Server Component and the route handler).
  await fetch('https://jsonplaceholder.typicode.com/users/1', { headers: { accept: 'application/json' } }).catch(
    () => {},
  )
  return { ok: true, at: new Date().toISOString() }
}
