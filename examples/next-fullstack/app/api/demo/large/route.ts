import { NextResponse } from 'next/server'

const ROW_COUNT = 1250 // ~100KB once stringified

/** Returns a sizeable JSON array so the response body is worth opening as a tree, not a wall of text. */
export async function GET() {
  const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: i,
    sku: `SKU-${1000 + i}`,
    label: `Widget ${i}`,
    priceCents: 999 + i,
    inStock: i % 3 !== 0,
  }))
  return NextResponse.json({ rows })
}
