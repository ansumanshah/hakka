'use client'

import { DemoCard } from './DemoCard'
import { RunButton } from './RunButton'

/** Hits the one route in this example that runs on the Edge runtime — tagged runtime: 'edge', the tag the runtime filter's third option needs. */
export function EdgeCard() {
  return (
    <DemoCard
      method="GET"
      path="/api/demo/edge"
      title="Edge runtime"
      description="Runs on the Edge runtime, not Node. Filter by Runtime > Edge to isolate it."
    >
      <RunButton
        testId="edge-runtime"
        idleLabel="Run on Edge"
        pendingLabel="Running…"
        run={async () => {
          const res = await fetch('/api/demo/edge')
          const data = (await res.json()) as { todo?: { title?: string } }
          return { ok: res.ok, status: res.status, note: data.todo?.title }
        }}
      />
    </DemoCard>
  )
}
