'use client'

import { pingServerAction } from '../../actions'
import { DemoCard } from './DemoCard'
import { RunStatus } from './RunStatus'
import { useTimedRun } from './useTimedRun'

/** Exercises the Server Action capture path: no route handler in between, just an RPC-style call. */
export function ServerActionCard() {
  const { state, run } = useTimedRun()

  const handleClick = () =>
    run(async () => {
      const result = await pingServerAction()
      return { ok: result.ok, note: `ran at ${new Date(result.at).toLocaleTimeString()}` }
    })

  return (
    <DemoCard
      method="ACTION"
      path="pingServerAction()"
      title="Run server action"
      description="Runs on the server and makes its own outbound fetch. No route handler involved."
    >
      <button
        type="button"
        className="demo-btn"
        data-testid="run-action"
        onClick={handleClick}
        disabled={state.phase === 'pending'}
      >
        {state.phase === 'pending' ? 'Running…' : 'Run server action'}
      </button>
      <RunStatus state={state} />
    </DemoCard>
  )
}
