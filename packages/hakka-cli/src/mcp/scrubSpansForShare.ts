import { scrubBodyForShare } from 'hakka-core'
import type { FrameworkSpan, ShareScrubRemoval } from 'hakka-core'

/** Scrub span labels and attributes while preserving correlation and timing fields. */
export function scrubSpansForShare(spans: FrameworkSpan[]): { spans: FrameworkSpan[]; removed: ShareScrubRemoval[] } {
  const totals = new Map<ShareScrubRemoval['category'], number>()
  const scrubbed = spans.map((span) => {
    const result = scrubBodyForShare(JSON.stringify({ name: span.name, attrs: span.attrs }))
    for (const item of result.removed) totals.set(item.category, (totals.get(item.category) ?? 0) + item.count)
    const fields = JSON.parse(result.body!) as Pick<FrameworkSpan, 'name' | 'attrs'>
    return { ...span, ...fields }
  })
  return { spans: scrubbed, removed: [...totals].map(([category, count]) => ({ category, count })) }
}
