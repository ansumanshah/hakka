'use client'

import { DemoCard } from './DemoCard'
import { RunButton } from './RunButton'

const QUERY = `query GetProducts {
  products { id name }
}`

/** A client fetch with a GraphQL-shaped body — url + operationName are exactly what hakka-core's op-name detector looks for, so the GraphQL detail tab has something real to show. */
export function GraphQLCard() {
  return (
    <DemoCard
      method="POST"
      path="/api/graphql"
      title="GraphQL query"
      description="A GraphQL-shaped POST. Open it and check the GraphQL detail tab."
    >
      <RunButton
        testId="graphql-query"
        idleLabel="Run GraphQL query"
        pendingLabel="Querying…"
        run={async () => {
          const res = await fetch('/api/graphql', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ operationName: 'GetProducts', query: QUERY }),
          })
          const data = (await res.json()) as { data?: { products?: unknown[] } }
          return { ok: res.ok, status: res.status, note: `${data.data?.products?.length ?? 0} products` }
        }}
      />
    </DemoCard>
  )
}
