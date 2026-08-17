import { NextResponse } from 'next/server'

/**
 * One URL, two methods: POST echoes a JSON body back with a server
 * timestamp, DELETE confirms removal. A clean way to see method chips differ
 * on requests to the same path.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => ({}))
  return NextResponse.json({ received: body, at: new Date().toISOString() })
}

export async function DELETE() {
  return NextResponse.json({ deleted: true, at: new Date().toISOString() })
}
