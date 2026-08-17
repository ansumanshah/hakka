import { buildEvidenceBundle, formatEvidenceBundleForAgent, groupRequests, logStore } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

import { copyToClipboard } from '../adapters/clipboard'
import type { StoreClient } from '../worker'

/**
 * agentEvidenceAction.ts — the single shared "Copy as agent context" action,
 * called from Detail, RequestRow's kebab menu, and RequestRow's error-row
 * affordance.
 *
 * Assembled entirely on the main thread — deliberately NOT a `StoreClient`/
 * `storeEngine` method. `ConsoleTab.tsx` reads `logStore` (hakka-core's
 * main-thread singleton) directly, and module-level singletons aren't shared
 * across the Worker boundary — a worker-side assembly would silently ship
 * `console: []` even though real entries exist main-thread-side. This helper
 * is the only place both `store` (bodies/spans) and `logStore` (console) are
 * simultaneously reachable.
 */
export async function copyAgentContextForRequest(store: StoreClient, req: NetworkRequest): Promise<boolean> {
  const groupId = req.correlationId ?? req.id
  const all = await store.getSnapshot()
  // groupRequests(all, 'trace') is the SAME grouping function
  // RequestListViewModel uses for trace view. Requests with no correlationId
  // group under key '', which never equals a real id, so the fallback
  // single-item group below fires for them instead — correct, since there's
  // no trace to correlate against.
  const group = groupRequests(all, 'trace').find((g) => g.key === groupId) ?? {
    key: groupId,
    label: '',
    items: [req],
  }

  const bodies = await store.getBodies(group.items.map((r) => r.id))
  const hydrated = group.items.map((r) => {
    const pair = bodies.get(r.id)
    return pair ? Object.assign({}, r, pair) : r
  })

  const spans = req.correlationId ? ((await store.getSpansForTrace?.(req.correlationId)) ?? []) : []

  const bundle = buildEvidenceBundle(hydrated, {
    focusRequestId: req.id,
    spans,
    logs: logStore.getEntries(),
  })

  return copyToClipboard(formatEvidenceBundleForAgent(bundle))
}
