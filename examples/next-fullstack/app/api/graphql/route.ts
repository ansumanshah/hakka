import { NextResponse } from 'next/server'

interface GraphQLRequestBody {
  query?: string
  operationName?: string
  variables?: Record<string, unknown>
}

/**
 * A tiny GraphQL-shaped endpoint — not a real GraphQL server, just a route
 * that returns `{ data }` for the one operation this demo sends. The URL
 * contains 'graphql' and the body carries `operationName`/`query`, exactly
 * what hakka-core's op-name detector (`utils/graphql.ts`'s
 * `extractGraphQLOperationName`) looks for, so the Detail > GraphQL tab has
 * something real to parse.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as GraphQLRequestBody

  if (body.operationName === 'GetProducts') {
    return NextResponse.json({
      data: {
        products: [
          { id: '1', name: 'Widget' },
          { id: '2', name: 'Gadget' },
          { id: '3', name: 'Gizmo' },
        ],
      },
    })
  }

  return NextResponse.json(
    { errors: [{ message: `Unknown operation: ${body.operationName ?? 'anonymous'}` }] },
    { status: 400 },
  )
}
