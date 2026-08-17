/**
 * TanStack Query integration — surfaces React Query cache activity in the
 * inspector's Logs tab with zero extra UI. Structurally typed against
 * QueryClient (see `QueryClientLike`) — no hard/peer dependency on
 * `@tanstack/react-query`.
 *
 * @example
 * ```ts
 * import { installTanstackQuery } from 'hakka-react-native'
 * import { queryClient } from './queryClient'
 *
 * const uninstall = installTanstackQuery(queryClient)
 * // later, e.g. on hot-reload teardown or app unmount:
 * uninstall()
 * ```
 */
import { log } from 'hakka-core'

/** Lifecycle state read off a query/mutation for logging. */
export type TanstackQueryLifecycleState = 'pending' | 'success' | 'error' | 'idle' | (string & {})

interface QueryStateLike {
  status: TanstackQueryLifecycleState
  fetchStatus?: string
  dataUpdatedAt?: number
  errorUpdatedAt?: number
  error?: unknown
}

interface QueryLike {
  queryKey: readonly unknown[]
  queryHash?: string
  state: QueryStateLike
}

interface QueryCacheNotifyEventLike {
  type: string
  query: QueryLike
  action?: { type?: string }
}

interface MutationStateLike {
  status: TanstackQueryLifecycleState
  submittedAt?: number
  error?: unknown
}

interface MutationLike {
  mutationId?: number
  options?: { mutationKey?: readonly unknown[] }
  state: MutationStateLike
}

interface MutationCacheNotifyEventLike {
  type: string
  mutation: MutationLike
}

interface QueryCacheLike {
  subscribe: (listener: (event: QueryCacheNotifyEventLike) => void) => () => void
}

interface MutationCacheLike {
  subscribe: (listener: (event: MutationCacheNotifyEventLike) => void) => () => void
}

/**
 * Minimal structural shape of a TanStack `QueryClient` — deliberately not
 * imported from `@tanstack/react-query` so this integration has no hard or
 * peer dependency on that package. Any real QueryClient satisfies this.
 */
export interface QueryClientLike {
  getQueryCache: () => QueryCacheLike
  getMutationCache: () => MutationCacheLike
}

export interface InstallTanstackQueryOptions {
  /** Log category. Defaults to 'query'. */
  category?: string
}

function formatQueryKey(queryKey: readonly unknown[]): string {
  try {
    return queryKey.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join('.')
  } catch {
    return String(queryKey)
  }
}

function formatDuration(updatedAt: number | undefined): string {
  if (!updatedAt) return ''
  const ms = Date.now() - updatedAt
  return ms >= 0 ? ` ${ms}ms` : ''
}

/** Query action types that represent a meaningful lifecycle transition. */
const QUERY_ACTION_LABELS: Record<string, string> = {
  fetch: 'fetch start',
  success: 'success',
  error: 'error',
  invalidate: 'invalidate',
}

function handleQueryEvent(event: QueryCacheNotifyEventLike, category: string): void {
  const actionType = event.action?.type
  // Only log meaningful lifecycle transitions, not every 'updated'/'added'/
  // 'removed'/'observerResultsUpdated' noise event.
  const label = event.type === 'updated' && actionType ? QUERY_ACTION_LABELS[actionType] : undefined
  if (!label) return

  const query = event.query
  const key = formatQueryKey(query.queryKey)
  const { state } = query
  const duration =
    actionType === 'success' || actionType === 'error'
      ? formatDuration(state.dataUpdatedAt ?? state.errorUpdatedAt)
      : ''

  const level = actionType === 'error' ? 'error' : 'info'
  const message = `query [${key}] -> ${label}${duration}`

  log(level, message, {
    category,
    metadata: {
      queryKey: query.queryKey,
      queryHash: query.queryHash,
      state: {
        status: state.status,
        fetchStatus: state.fetchStatus,
        dataUpdatedAt: state.dataUpdatedAt,
        errorUpdatedAt: state.errorUpdatedAt,
      },
      ...(state.error !== undefined ? { error: state.error } : {}),
    },
  })
}

const MUTATION_ACTION_LABELS: Record<string, string> = {
  pending: 'fetch start',
  success: 'success',
  error: 'error',
}

function handleMutationEvent(event: MutationCacheNotifyEventLike, category: string): void {
  if (event.type !== 'updated') return

  const mutation = event.mutation
  const { state } = mutation
  const label = MUTATION_ACTION_LABELS[state.status]
  if (!label) return

  const key = mutation.options?.mutationKey
    ? formatQueryKey(mutation.options.mutationKey)
    : `mutation:${mutation.mutationId ?? '?'}`
  const duration = state.status === 'success' || state.status === 'error' ? formatDuration(state.submittedAt) : ''

  const level = state.status === 'error' ? 'error' : 'info'
  const message = `query [${key}] -> ${label}${duration}`

  log(level, message, {
    category,
    metadata: {
      queryKey: mutation.options?.mutationKey,
      state: {
        status: state.status,
      },
      ...(state.error !== undefined ? { error: state.error } : {}),
    },
  })
}

/**
 * Subscribe to a TanStack QueryClient's query + mutation caches and forward
 * lifecycle events (fetch start, success, error, invalidate) to the Logs tab
 * via `log()`. Never throws — if the client doesn't expose the expected
 * caches, this is a no-op returning a safe no-op `uninstall`.
 */
export function installTanstackQuery(queryClient: QueryClientLike, options?: InstallTanstackQueryOptions): () => void {
  const category = options?.category ?? 'query'

  try {
    const queryUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
      try {
        handleQueryEvent(event, category)
      } catch {
        // Never let a logging failure break the app's query cache.
      }
    })

    const mutationUnsubscribe = queryClient.getMutationCache().subscribe((event) => {
      try {
        handleMutationEvent(event, category)
      } catch {
        // Never let a logging failure break the app's mutation cache.
      }
    })

    return () => {
      queryUnsubscribe()
      mutationUnsubscribe()
    }
  } catch {
    return () => {}
  }
}
