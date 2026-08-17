import { NextResponse } from 'next/server'

const DELAY_MS = 2500

/** Waits ~2.5s before responding, long enough to watch the timing waterfall fill in. */
export async function GET() {
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
  return NextResponse.json({ sleptMs: DELAY_MS })
}
