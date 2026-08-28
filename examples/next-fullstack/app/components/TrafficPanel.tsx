'use client'

import { BurstCard } from './traffic/BurstCard'
import { DemoCard } from './traffic/DemoCard'
import { EdgeCard } from './traffic/EdgeCard'
import { EmitLogsCard } from './traffic/EmitLogsCard'
import { FetchCachedCard } from './traffic/FetchCachedCard'
import { FetchProductsCard } from './traffic/FetchProductsCard'
import { GraphQLCard } from './traffic/GraphQLCard'
import { RunButton } from './traffic/RunButton'
import { SecureCard } from './traffic/SecureCard'
import { ServerActionCard } from './traffic/ServerActionCard'
import { StorageCard } from './traffic/StorageCard'
import { WebSocketCard } from './traffic/WebSocketCard'

/**
 * "Generate traffic" — every button here fires a real request through the
 * dev server (Storage is the one exception — it writes to the browser
 * directly, no network call). Client component: several cards close over
 * browser `fetch`/`WebSocket` calls, and a Server Component can't hand a
 * function like that down to a Client Component as a prop, so the whole
 * panel has to live on this side of the boundary. `Core flow` is the
 * original three calls (client -> route -> upstream, a hand-stamped cache
 * badge, a Server Action); `Push it further` exercises severity stripes, the
 * timing waterfall, method chips, a large response tree, Stats, Logs, the
 * Edge runtime, GraphQL, WebSocket frames, redacted headers + cookies, and
 * the Storage tab.
 */
export function TrafficPanel() {
  return (
    <section aria-labelledby="traffic-heading" className="demo-section">
      <h2 id="traffic-heading" className="demo-section-title">
        Generate traffic
      </h2>
      <p className="demo-section-desc">
        Each card fires a real request. Open the inspector first, then click through and watch the list fill in.
      </p>

      <h3 className="demo-group-title">Core flow</h3>
      <div className="demo-grid">
        <FetchProductsCard />
        <FetchCachedCard />
        <ServerActionCard />
      </div>

      <h3 className="demo-group-title">Push it further</h3>
      <div className="demo-grid">
        <DemoCard
          method="GET"
          path="/api/demo/fail"
          title="Fail request"
          description="Always returns 500. Watch the chili severity stripe."
        >
          <RunButton
            testId="fail-500"
            idleLabel="Fail on purpose"
            pendingLabel="Failing…"
            run={async () => {
              const res = await fetch('/api/demo/fail')
              return { ok: res.ok, status: res.status, note: 'that failure was on purpose' }
            }}
          />
        </DemoCard>

        <DemoCard
          method="GET"
          path="/api/demo/missing"
          title="Not found"
          description="Always returns 404. Watch the turmeric stripe instead."
        >
          <RunButton
            testId="fail-404"
            idleLabel="Request missing resource"
            pendingLabel="Asking…"
            run={async () => {
              const res = await fetch('/api/demo/missing')
              return { ok: res.ok, status: res.status, note: 'also on purpose' }
            }}
          />
        </DemoCard>

        <DemoCard
          method="GET"
          path="/api/demo/slow"
          title="Slow request"
          description="Takes about 2.5 seconds. Open its waterfall while it runs."
        >
          <RunButton
            testId="slow-request"
            idleLabel="Run slow request"
            pendingLabel="Waiting…"
            run={async () => {
              const res = await fetch('/api/demo/slow')
              return { ok: res.ok, status: res.status }
            }}
          />
        </DemoCard>

        <DemoCard
          method="POST"
          path="/api/demo/echo"
          title="POST with a body"
          description="Sends a small JSON payload and gets it echoed back."
        >
          <RunButton
            testId="post-json"
            idleLabel="Send POST"
            pendingLabel="Sending…"
            run={async () => {
              const res = await fetch('/api/demo/echo', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ note: 'hello from the demo page', sentAt: new Date().toISOString() }),
              })
              const data = (await res.json()) as { received?: { note?: string } }
              return { ok: res.ok, status: res.status, note: data.received?.note }
            }}
          />
        </DemoCard>

        <DemoCard
          method="DELETE"
          path="/api/demo/echo"
          title="Delete"
          description="Same URL as the POST above, a different method chip in the row."
        >
          <RunButton
            testId="delete-call"
            idleLabel="Send DELETE"
            pendingLabel="Sending…"
            run={async () => {
              const res = await fetch('/api/demo/echo', { method: 'DELETE' })
              return { ok: res.ok, status: res.status, note: 'confirmed' }
            }}
          />
        </DemoCard>

        <DemoCard
          method="GET"
          path="/api/demo/large"
          title="Large response"
          description="Returns close to 100KB of JSON. Worth opening as a tree."
        >
          <RunButton
            testId="large-json"
            idleLabel="Fetch large response"
            pendingLabel="Fetching…"
            run={async () => {
              const res = await fetch('/api/demo/large')
              const text = await res.text()
              return { ok: res.ok, status: res.status, note: `${Math.round(text.length / 1024)} KB` }
            }}
          />
        </DemoCard>

        <BurstCard />
        <EmitLogsCard />
        <EdgeCard />
        <GraphQLCard />
        <WebSocketCard />
        <SecureCard />
        <StorageCard />
      </div>
    </section>
  )
}
