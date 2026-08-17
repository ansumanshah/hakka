import type { RunState } from './useTimedRun'

interface RunStatusProps {
  state: RunState
}

/**
 * The small, quiet result line under a demo button: status code, duration,
 * and an optional note, all mono for the numbers. No hooks here, so this
 * stays a plain component the client cards render straight into their JSX.
 */
export function RunStatus({ state }: RunStatusProps) {
  if (state.phase !== 'done') return null

  return (
    <p className={`demo-result ${state.ok ? 'demo-result-ok' : 'demo-result-err'}`}>
      {state.status !== undefined && <span className="demo-mono">{state.status}</span>}
      {state.status !== undefined && ' · '}
      <span className="demo-mono">{state.durationMs}ms</span>
      {state.note && <span className="demo-result-note"> · {state.note}</span>}
    </p>
  )
}
