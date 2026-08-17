'use client'

import { useCallback, useState } from 'react'

/** What a demo action reports back once it settles. */
export interface RunResult {
  ok: boolean
  status?: number
  note?: string
}

/**
 * Timed state for one demo action: idle, pending, or done with the elapsed
 * time plus whatever the task reported. Every traffic card on the page shares
 * this shape so the inline status line (pending/success, status + duration)
 * looks and behaves the same everywhere.
 */
export type RunState =
  | { phase: 'idle' }
  | { phase: 'pending' }
  | { phase: 'done'; ok: boolean; status?: number; durationMs: number; note?: string }

export function useTimedRun() {
  const [state, setState] = useState<RunState>({ phase: 'idle' })

  const run = useCallback(async (task: () => Promise<RunResult>) => {
    setState({ phase: 'pending' })
    const started = performance.now()
    try {
      const result = await task()
      setState({ phase: 'done', durationMs: Math.round(performance.now() - started), ...result })
    } catch (e: unknown) {
      const note = e instanceof Error ? e.message : 'network error'
      setState({ phase: 'done', ok: false, durationMs: Math.round(performance.now() - started), note })
    }
  }, [])

  return { state, run }
}
