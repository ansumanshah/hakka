import { NextResponse } from 'next/server'

/**
 * Demonstrates the cache-status badge (Next Request Insights feature 3)
 * without needing real Vercel infrastructure. A plain outbound
 * `fetch(url, { next: { revalidate } })` (see the Server Component in
 * `app/page.tsx`) carries NEITHER `x-nextjs-cache` nor `x-vercel-cache` in
 * local dev — see `serverCapture.ts`'s `CACHE_STATUS_HEADERS` doc for why —
 * so its cache badge never lights up here. This route hand-stamps the same
 * header Vercel's edge network sets on a real hit, cycling HIT → HIT → STALE
 * so both badge tones are easy to see in one sitting.
 */
let hits = 0

export async function GET() {
  hits += 1
  const status = hits % 3 === 0 ? 'STALE' : 'HIT'
  return NextResponse.json({ hits, status }, { headers: { 'x-vercel-cache': status } })
}
