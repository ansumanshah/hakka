import { NextResponse } from 'next/server'

/**
 * Always fails with a 500 so the inspector's chili severity stripe and the
 * error status class have something real to show. Open the row afterward —
 * the body explains itself.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Demo failure', detail: 'This route always returns 500 so failures are easy to demo.' },
    { status: 500 },
  )
}
