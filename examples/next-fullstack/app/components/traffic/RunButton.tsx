'use client'

import { RunStatus } from './RunStatus'
import { useTimedRun, type RunResult } from './useTimedRun'

interface RunButtonProps {
  testId: string
  idleLabel: string
  pendingLabel: string
  run: () => Promise<RunResult>
}

/** A button + inline status line for the simpler one-shot demo cards (fail, 404, slow, POST, DELETE, large). */
export function RunButton({ testId, idleLabel, pendingLabel, run: task }: RunButtonProps) {
  const { state, run } = useTimedRun()

  return (
    <>
      <button
        type="button"
        className="demo-btn"
        data-testid={testId}
        onClick={() => run(task)}
        disabled={state.phase === 'pending'}
      >
        {state.phase === 'pending' ? pendingLabel : idleLabel}
      </button>
      <RunStatus state={state} />
    </>
  )
}
