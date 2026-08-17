'use client'

import { DemoCard } from './DemoCard'
import { RunStatus } from './RunStatus'
import { useTimedRun } from './useTimedRun'

interface BurstCall {
  url: string
  init?: RequestInit
}

/** Eight calls, mixed on purpose: two flows above, a big body, a slow one, a 404, a 500, a POST, a DELETE. */
const BURST_CALLS: BurstCall[] = [
  { url: '/api/products' },
  { url: '/api/cached' },
  { url: '/api/demo/large' },
  { url: '/api/demo/slow' },
  { url: '/api/demo/missing' },
  { url: '/api/demo/fail' },
  {
    url: '/api/demo/echo',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'burst' }),
    },
  },
  { url: '/api/demo/echo', init: { method: 'DELETE' } },
]

/** Fires the mix above with Promise.allSettled and reports the status-class breakdown. Good fodder for Stats. */
export function BurstCard() {
  const { state, run } = useTimedRun()

  const handleClick = () =>
    run(async () => {
      const settled = await Promise.allSettled(BURST_CALLS.map((call) => fetch(call.url, call.init)))
      const statuses = settled.map((r) => (r.status === 'fulfilled' ? r.value.status : 0))
      const ok = statuses.filter((s) => s >= 200 && s < 300).length
      const clientErr = statuses.filter((s) => s >= 400 && s < 500).length
      const serverErr = statuses.filter((s) => s >= 500).length
      return { ok: true, note: `${ok} ok, ${clientErr} client error, ${serverErr} server error` }
    })

  return (
    <DemoCard
      method="PARALLEL"
      path="8 requests at once"
      title="Burst"
      description="Fires eight mixed requests together: GET, POST, DELETE, a 404, a 500. Good for checking Stats."
    >
      <button
        type="button"
        className="demo-btn"
        data-testid="burst"
        onClick={handleClick}
        disabled={state.phase === 'pending'}
      >
        {state.phase === 'pending' ? 'Firing…' : 'Fire burst'}
      </button>
      <RunStatus state={state} />
    </DemoCard>
  )
}
