'use client'

import { DemoCard } from './DemoCard'
import { RunStatus } from './RunStatus'
import { useTimedRun } from './useTimedRun'

/** Writes one line at each console level, purely so the Logs tab has real content to filter. */
export function EmitLogsCard() {
  const { state, run } = useTimedRun()

  const handleClick = () =>
    run(async () => {
      console.log('[hakka-demo] fetching products for the dashboard')
      console.warn('[hakka-demo] upstream took longer than expected')
      console.error('[hakka-demo] simulated failure in /api/demo/fail')
      return { ok: true, note: 'wrote info, warn, and error' }
    })

  return (
    <DemoCard
      method="CONSOLE"
      path="console.log / warn / error"
      title="Emit logs"
      description="Writes one line at each level so the Logs tab has something to filter."
    >
      <button
        type="button"
        className="demo-btn"
        data-testid="emit-logs"
        onClick={handleClick}
        disabled={state.phase === 'pending'}
      >
        {state.phase === 'pending' ? 'Writing…' : 'Emit logs'}
      </button>
      <RunStatus state={state} />
    </DemoCard>
  )
}
