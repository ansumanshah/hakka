import { NextResponse } from 'next/server'

/**
 * Always 404s. A dedicated JSON route rather than an unknown path, so the
 * response body and the turmeric 4xx styling are both visible in the
 * inspector instead of Next's own not-found HTML.
 */
export async function GET() {
  return NextResponse.json({ error: 'Demo resource not found' }, { status: 404 })
}
