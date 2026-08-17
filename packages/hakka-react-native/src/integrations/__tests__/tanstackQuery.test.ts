/**
 * Unit tests for src/integrations/tanstackQuery.ts — installTanstackQuery
 */
import { logStore } from 'hakka-core'
import type { LogEntry } from 'hakka-core'

import { installTanstackQuery } from '../tanstackQuery'
import type { QueryClientLike } from '../tanstackQuery'

/** Minimal fake QueryCache/MutationCache — just enough to drive subscribe(). */
function createFakeQueryClient(): {
  client: QueryClientLike
  emitQuery: (event: unknown) => void
  emitMutation: (event: unknown) => void
} {
  const queryListeners = new Set<(event: unknown) => void>()
  const mutationListeners = new Set<(event: unknown) => void>()

  const client: QueryClientLike = {
    getQueryCache: () => ({
      subscribe: (listener) => {
        queryListeners.add(listener as (event: unknown) => void)
        return () => queryListeners.delete(listener as (event: unknown) => void)
      },
    }),
    getMutationCache: () => ({
      subscribe: (listener) => {
        mutationListeners.add(listener as (event: unknown) => void)
        return () => mutationListeners.delete(listener as (event: unknown) => void)
      },
    }),
  }

  return {
    client,
    emitQuery: (event) => queryListeners.forEach((l) => l(event)),
    emitMutation: (event) => mutationListeners.forEach((l) => l(event)),
  }
}

function collectNewEntries(): { entries: LogEntry[]; stop: () => void } {
  const entries: LogEntry[] = []
  const unsubscribe = logStore.subscribe((entry) => entries.push(entry))
  return { entries, stop: unsubscribe }
}

describe('installTanstackQuery', () => {
  beforeEach(() => {
    logStore.clear()
  })

  it('emits a log entry on a query success event', () => {
    const { client, emitQuery } = createFakeQueryClient()
    const uninstall = installTanstackQuery(client)
    const { entries, stop } = collectNewEntries()

    emitQuery({
      type: 'updated',
      action: { type: 'success' },
      query: {
        queryKey: ['todos', 1],
        queryHash: '["todos",1]',
        state: {
          status: 'success',
          fetchStatus: 'idle',
          dataUpdatedAt: Date.now(),
          errorUpdatedAt: 0,
        },
      },
    })

    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry.category).toBe('query')
    expect(entry.level).toBe('info')
    expect(entry.message).toMatch(/^query \[todos\.1\] -> success/)
    expect(entry.metadata?.queryKey).toEqual(['todos', 1])
    const state = entry.metadata?.state as { status: string } | undefined
    expect(state?.status).toBe('success')

    stop()
    uninstall()
  })

  it('emits an error-level log entry on a query error event', () => {
    const { client, emitQuery } = createFakeQueryClient()
    installTanstackQuery(client)
    const { entries, stop } = collectNewEntries()

    emitQuery({
      type: 'updated',
      action: { type: 'error' },
      query: {
        queryKey: ['todos'],
        state: {
          status: 'error',
          fetchStatus: 'idle',
          dataUpdatedAt: 0,
          errorUpdatedAt: Date.now(),
          error: new Error('boom'),
        },
      },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('error')
    expect(entries[0].message).toMatch(/^query \[todos\] -> error/)
    expect(entries[0].metadata?.error).toBeInstanceOf(Error)

    stop()
  })

  it('emits a log entry on a mutation success event', () => {
    const { client } = createFakeQueryClient()
    const mutationListeners = new Set<(event: unknown) => void>()
    // Rebuild client with an inspectable mutation cache for this test.
    const clientWithMutation: QueryClientLike = {
      getQueryCache: client.getQueryCache,
      getMutationCache: () => ({
        subscribe: (listener) => {
          mutationListeners.add(listener as (event: unknown) => void)
          return () => mutationListeners.delete(listener as (event: unknown) => void)
        },
      }),
    }

    installTanstackQuery(clientWithMutation)
    const { entries, stop } = collectNewEntries()

    mutationListeners.forEach((l) =>
      l({
        type: 'updated',
        mutation: {
          mutationId: 1,
          options: { mutationKey: ['createTodo'] },
          state: { status: 'success', submittedAt: Date.now() },
        },
      }),
    )

    expect(entries).toHaveLength(1)
    expect(entries[0].message).toMatch(/^query \[createTodo\] -> success/)

    stop()
  })

  it('ignores non-lifecycle events (e.g. observerResultsUpdated)', () => {
    const { client, emitQuery } = createFakeQueryClient()
    installTanstackQuery(client)
    const { entries, stop } = collectNewEntries()

    emitQuery({
      type: 'observerResultsUpdated',
      query: { queryKey: ['todos'], state: { status: 'success', fetchStatus: 'idle' } },
    })

    expect(entries).toHaveLength(0)
    stop()
  })

  it('uninstall() stops further log emission', () => {
    const { client, emitQuery } = createFakeQueryClient()
    const uninstall = installTanstackQuery(client)
    uninstall()

    const { entries, stop } = collectNewEntries()
    emitQuery({
      type: 'updated',
      action: { type: 'success' },
      query: { queryKey: ['todos'], state: { status: 'success', fetchStatus: 'idle', dataUpdatedAt: Date.now() } },
    })

    expect(entries).toHaveLength(0)
    stop()
  })

  it('respects a custom category option', () => {
    const { client, emitQuery } = createFakeQueryClient()
    installTanstackQuery(client, { category: 'react-query' })
    const { entries, stop } = collectNewEntries()

    emitQuery({
      type: 'updated',
      action: { type: 'fetch' },
      query: { queryKey: ['todos'], state: { status: 'pending', fetchStatus: 'fetching' } },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0].category).toBe('react-query')

    stop()
  })
})
