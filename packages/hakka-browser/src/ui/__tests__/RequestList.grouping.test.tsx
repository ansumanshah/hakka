import { render } from '@solidjs/testing-library'
import type { RequestGroup } from 'hakka-core'
import { groupRequests } from 'hakka-core'
import { describe, it, expect } from 'vitest'

import { RequestList } from '../RequestList'
import { makeGroup, makeReq } from './requestListFixtures'

describe('RequestList grouped rendering', () => {
  it('renders group headers when groups prop is non-null', () => {
    const a = makeReq('a', { url: 'https://api.example.com/foo' })
    const b = makeReq('b', { url: 'https://cdn.example.com/bar' })
    const groups: RequestGroup[] = groupRequests([a, b], 'host')
    const { container } = render(() => (
      <RequestList
        requests={[a, b]}
        groups={groups}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    const headers = container.querySelectorAll('.hakka-group-header')
    expect(headers.length).toBe(2)
    const labels = Array.from(headers).map((h) => h.querySelector('.hakka-group-label')?.textContent ?? '')
    expect(labels).toContain('api.example.com')
    expect(labels).toContain('cdn.example.com')
  })

  it('shows group count badges', () => {
    const a = makeReq('a', { method: 'GET' })
    const b = makeReq('b', { method: 'GET' })
    const c = makeReq('c', { method: 'POST' })
    const groups: RequestGroup[] = groupRequests([a, b, c], 'method')
    const { container } = render(() => (
      <RequestList
        requests={[a, b, c]}
        groups={groups}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    const counts = Array.from(container.querySelectorAll('.hakka-group-header .hakka-count-badge')).map(
      (el) => el.textContent,
    )
    expect(counts).toContain('2')
    expect(counts).toContain('1')
  })

  it('still renders rows within each group', () => {
    const a = makeReq('a', { url: 'https://api.example.com/foo' })
    const b = makeReq('b', { url: 'https://api.example.com/bar' })
    const groups: RequestGroup[] = groupRequests([a, b], 'host')
    const { container } = render(() => (
      <RequestList
        requests={[a, b]}
        groups={groups}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    expect(container.querySelectorAll('.hakka-row').length).toBe(2)
  })
})

describe('RequestList grouped virtualization', () => {
  it('windows the grouped branch once total flattened items (headers + rows) exceed the threshold', () => {
    // 3 groups × 25 rows + 3 headers = 78 flattened entries — over VIRTUALIZE_ABOVE (60).
    const groups = [makeGroup('a', 25), makeGroup('b', 25), makeGroup('c', 25)]
    const allReqs = groups.flatMap((g) => g.items)
    const { container } = render(() => (
      <RequestList
        requests={allReqs}
        groups={groups}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    const rows = container.querySelectorAll('.hakka-row').length
    const headers = container.querySelectorAll('.hakka-group-header').length
    // Windowed: some rows render (a screen's worth), but nowhere near the 75 total.
    expect(rows).toBeGreaterThan(0)
    expect(rows).toBeLessThan(75)
    expect(headers).toBeLessThanOrEqual(3)
  })

  it('keeps full, unvirtualized rendering for a grouped list at/under the threshold', () => {
    // 2 groups × 20 rows + 2 headers = 42 flattened entries — under the threshold,
    // so every row of every group renders exactly as it did before virtualization.
    const groups = [makeGroup('a', 20), makeGroup('b', 20)]
    const allReqs = groups.flatMap((g) => g.items)
    const { container } = render(() => (
      <RequestList
        requests={allReqs}
        groups={groups}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    expect(container.querySelectorAll('.hakka-row').length).toBe(40)
    expect(container.querySelectorAll('.hakka-group-header').length).toBe(2)
  })
})
