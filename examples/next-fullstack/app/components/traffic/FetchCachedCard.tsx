'use client'

import { DemoCard } from './DemoCard'
import { RunStatus } from './RunStatus'
import { useTimedRun } from './useTimedRun'

/** Hand-stamps x-vercel-cache so the cache-status badge has HIT/STALE to show without real Vercel infra. */
export function FetchCachedCard() {
  const { state, run } = useTimedRun()

  const handleClick = () =>
    run(async () => {
      const res = await fetch('/api/cached')
      const data = (await res.json()) as { hits: number; status: string }
      return { ok: res.ok, status: res.status, note: `hit #${data.hits}, ${data.status}` }
    })

  return (
    <DemoCard
      method="GET"
      path="/api/cached"
      title="Fetch cached route"
      description="Cycles HIT, HIT, STALE so the x-vercel-cache badge has something to show."
    >
      <button
        type="button"
        className="demo-btn"
        data-testid="fetch-cached"
        onClick={handleClick}
        disabled={state.phase === 'pending'}
      >
        {state.phase === 'pending' ? 'Fetching…' : 'Fetch cached route'}
      </button>
      <RunStatus state={state} />
    </DemoCard>
  )
}
