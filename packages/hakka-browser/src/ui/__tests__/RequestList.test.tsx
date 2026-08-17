import { render, waitFor } from '@solidjs/testing-library'
import type { FrameworkSpan, NetworkRequest, RequestGroup } from 'hakka-core'
import { deriveTraceId, groupRequests, compileQuery, parseSearchTokens } from 'hakka-core'
import { describe, it, expect } from 'vitest'

import { RequestList } from '../RequestList'

function makeSpan(id: string, overrides: Partial<FrameworkSpan> = {}): FrameworkSpan {
  return {
    id,
    traceId: 'trace-1',
    parentId: null,
    name: 'BaseServer.handleRequest',
    startTime: 0,
    endTime: 10,
    verbosity: 'primary',
    runtime: 'server',
    ...overrides,
  }
}

function reqs(n: number): NetworkRequest[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `r${i}`,
        url: `https://api.example.com/item/${i}`,
        method: 'GET',
        status: 200,
        startTime: i,
        requestHeaders: {},
        responseHeaders: {},
        source: 'fetch',
      }) as NetworkRequest,
  )
}

function makeReq(id: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id,
    url: `https://example.com/${id}`,
    method: 'GET',
    status: 200,
    startTime: 0,
    requestHeaders: {},
    responseHeaders: {},
    source: 'fetch',
    ...overrides,
  } as NetworkRequest
}

describe('compileQuery advanced search', () => {
  it('filters by scoped url: token', () => {
    const a = makeReq('a', { url: 'https://api.example.com/users' })
    const b = makeReq('b', { url: 'https://cdn.example.com/image.png' })
    const match = compileQuery({ tokens: parseSearchTokens('url:/users') })
    expect([a, b].filter(match).map((r) => r.id)).toEqual(['a'])
  })

  it('filters with /regex/ notation', () => {
    const a = makeReq('a', { url: 'https://api.example.com/users' })
    const b = makeReq('b', { url: 'https://api.example.com/orders' })
    const match = compileQuery({ tokens: parseSearchTokens('/user/') })
    expect([a, b].filter(match).map((r) => r.id)).toEqual(['a'])
  })

  it('supports negation with -prefix', () => {
    const a = makeReq('a', { url: 'https://api.example.com/users' })
    const b = makeReq('b', { url: 'https://api.example.com/orders' })
    const match = compileQuery({ tokens: parseSearchTokens('-orders') })
    expect([a, b].filter(match).map((r) => r.id)).toEqual(['a'])
  })

  it('filters via *glob* wildcard', () => {
    const a = makeReq('a', { url: 'https://api.example.com/users/123' })
    const b = makeReq('b', { url: 'https://cdn.example.com/logo.png' })
    const match = compileQuery({ tokens: parseSearchTokens('*api*users*') })
    expect([a, b].filter(match).map((r) => r.id)).toEqual(['a'])
  })
})

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

describe('RequestList virtualization', () => {
  it('renders every row for small lists', () => {
    const { container } = render(() => (
      <RequestList
        requests={reqs(10)}
        groups={null}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    expect(container.querySelectorAll('.hakka-row').length).toBe(10)
  })

  it('renders only a window of rows for large lists', () => {
    const { container } = render(() => (
      <RequestList
        requests={reqs(300)}
        groups={null}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    const rendered = container.querySelectorAll('.hakka-row').length
    // Windowed: far fewer than 300, but at least one screen's worth.
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(60)
  })

  it('shows the empty state with no requests', () => {
    const { container } = render(() => (
      <RequestList
        requests={[]}
        groups={null}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    expect(container.querySelector('.hakka-list-empty')).toBeTruthy()
    expect(container.querySelectorAll('.hakka-row').length).toBe(0)
  })

  it('omits the "Load sample traffic" button when onLoadSample is not provided', () => {
    const { container } = render(() => (
      <RequestList
        requests={[]}
        groups={null}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    expect(container.querySelector('.hakka-empty-sample-btn')).toBeNull()
  })

  it('shows a "Load sample traffic" button on the empty state and invokes onLoadSample', () => {
    let called = 0
    const { container } = render(() => (
      <RequestList
        requests={[]}
        groups={null}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
        onLoadSample={() => {
          called++
        }}
      />
    ))
    const btn = container.querySelector('.hakka-empty-sample-btn') as HTMLButtonElement | null
    expect(btn).toBeTruthy()
    expect(btn?.textContent).toContain('Load sample traffic')
    btn?.click()
    expect(called).toBe(1)
  })

  it('does not show the sample button when there are requests', () => {
    const { container } = render(() => (
      <RequestList
        requests={reqs(3)}
        groups={null}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
        onLoadSample={() => {}}
      />
    ))
    expect(container.querySelector('.hakka-empty-sample-btn')).toBeNull()
  })
})

function makeGroup(key: string, count: number): RequestGroup {
  const items = Array.from({ length: count }, (_, i) =>
    makeReq(`${key}-${i}`, { url: `https://${key}.example.com/item/${i}` }),
  )
  return { key, label: key, items }
}

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

function makeTraceHop(id: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id,
    url: `https://trace.example.com/${id}`,
    method: 'GET',
    status: 200,
    startTime: 0,
    requestHeaders: {},
    responseHeaders: {},
    source: 'fetch',
    ...overrides,
  } as NetworkRequest
}

describe('RequestList trace waterfall (lazy)', () => {
  it('lazily renders TraceWaterfall for a trace group once traceView is on', async () => {
    const group: RequestGroup = {
      key: 'trace-1',
      label: 'Trace trace-1',
      items: [
        makeTraceHop('trace-a', { startTime: 0, endTime: 100, duration: 100 }),
        makeTraceHop('trace-b', { startTime: 10, endTime: 60, duration: 50 }),
      ],
    }
    const { container } = render(() => (
      <RequestList
        requests={group.items}
        groups={[group]}
        traceView={true}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    // Not necessarily present on the very first synchronous render (lazy chunk
    // fetch is async) — wait for the Suspense boundary to resolve.
    await waitFor(() => expect(container.querySelector('.hakka-trace-wf')).toBeTruthy())
    expect(container.querySelectorAll('.hakka-wf-hop').length).toBe(2)
  })

  it('does not render a waterfall for the "No trace" bucket (empty key) even with traceView on', async () => {
    const group: RequestGroup = { key: '', label: 'No trace', items: [makeTraceHop('a'), makeTraceHop('b')] }
    const { container } = render(() => (
      <RequestList
        requests={group.items}
        groups={[group]}
        traceView={true}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.querySelector('.hakka-trace-wf')).toBeNull()
  })
})

describe('RequestList row severity precedence (P5 B2 audit Finding 3)', () => {
  // The error signal always wins for severity, regardless of a captured
  // status code — matches the Detail panel's precedence.
  it('marks a row as errored (is-error stripe) when status is 200 but req.error is set', () => {
    const { container } = render(() => (
      <RequestList
        requests={[makeReq('a', { status: 200, error: 'ECONNRESET' })]}
        groups={null}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    const row = container.querySelector('.hakka-row')
    expect(row?.classList.contains('is-error')).toBe(true)
    // Only the stripe class is asserted here — statusLabel's own 'ERR' text
    // convention is out of scope.
  })

  it('does not mark a 2xx row as errored when there is no error', () => {
    const { container } = render(() => (
      <RequestList
        requests={[makeReq('a', { status: 200 })]}
        groups={null}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    const row = container.querySelector('.hakka-row')
    expect(row?.classList.contains('is-error')).toBe(false)
  })
})

describe('RequestList — TraceBadgeRow (Next Request Insights design doc feature 4)', () => {
  it('renders a TraceBadgeRow for a trace group with traceView on', () => {
    const group = makeGroup('trace-a', 3)
    const { container } = render(() => (
      <RequestList
        requests={group.items}
        groups={[group]}
        traceView={true}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    // TraceBadgeRow is not lazy (unlike TraceWaterfall) — renders synchronously.
    expect(container.querySelector('.hakka-trace-badges')).toBeTruthy()
  })

  it('does not render a TraceBadgeRow for the "No trace" bucket (empty key) even with traceView on', () => {
    const group: RequestGroup = { key: '', label: 'No trace', items: [makeReq('a'), makeReq('b')] }
    const { container } = render(() => (
      <RequestList
        requests={group.items}
        groups={[group]}
        traceView={true}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    expect(container.querySelector('.hakka-trace-badges')).toBeNull()
  })

  it('does not render a TraceBadgeRow when not grouped by trace (traceView off)', () => {
    const group = makeGroup('host-a', 3)
    const { container } = render(() => (
      <RequestList
        requests={group.items}
        groups={[group]}
        traceView={false}
        selected={null}
        onSelect={() => {}}
        selectMode={false}
        selectedIds={new Set<string>()}
        onToggleSelect={() => {}}
        compact={false}
      />
    ))
    expect(container.querySelector('.hakka-trace-badges')).toBeNull()
  })
})

describe('RequestList — span-aware virtualization height math (design doc §5 virtualization risk)', () => {
  // 11 groups × (1 header + 5 rows) = 66 flattened entries — over VIRTUALIZE_ABOVE (60),
  // so the grouped branch windows by pixel offset (windowFlatItems).
  function bigTraceGroups(): RequestGroup[] {
    return Array.from({ length: 11 }, (_, i) => makeGroup(`g${i}`, 5))
  }

  it('a group height must come from assembleTraceTree(items, spans) — not group.items.length — once spans exist', () => {
    // g9 sits well beyond the initial render window (scrollTop=0, default
    // viewport fallback), so its height only ever shows up in padBottom —
    // never in padTop or the rendered slice. That isolates the height delta.
    const groups = bigTraceGroups()
    const allReqs = groups.flatMap((g) => g.items)
    const baseProps = {
      requests: allReqs,
      groups,
      traceView: true,
      selected: null,
      onSelect: () => {},
      selectMode: false,
      selectedIds: new Set<string>(),
      onToggleSelect: () => {},
      compact: false,
    }

    const padBottomOf = (container: HTMLElement): number => {
      // The pad spacers are the only unclassed `<div style="height:...">`
      // direct children of `.hakka-list` — every rendered row/header/badge
      // element carries its own class. padTop doesn't render at all when 0
      // (see the `Show when={... > 0}` guards), so the LAST match is padBottom.
      const spacers = Array.from(container.querySelectorAll('.hakka-list > div')).filter(
        (el) => !(el as HTMLElement).className && (el as HTMLElement).style.height,
      )
      const last = spacers[spacers.length - 1] as HTMLElement | undefined
      return last ? Number.parseFloat(last.style.height) : 0
    }

    const { container: withoutSpans } = render(() => <RequestList {...baseProps} />)
    const padBottomBase = padBottomOf(withoutSpans)

    // Same shape, but g9's trace now carries 3 extra framework spans on top
    // of its 5 request hops — assembleTraceTree's bar count is 5+3=8, not 5.
    // Spans (and the VM's map keys) carry the derived W3C traceId, never the
    // raw correlationId the group is keyed by.
    const g9Trace = deriveTraceId('g9')
    const spansByTrace = new Map<string, FrameworkSpan[]>([
      [
        g9Trace,
        [
          makeSpan('s1', { traceId: g9Trace }),
          makeSpan('s2', { traceId: g9Trace }),
          makeSpan('s3', { traceId: g9Trace }),
        ],
      ],
    ])
    const { container: withSpans } = render(() => <RequestList {...baseProps} spansByTrace={spansByTrace} />)
    const padBottomWithSpans = padBottomOf(withSpans)

    // DEFAULT_WF_HOP_HEIGHT = 20px per extra bar. A stale `group.items.length`
    // estimate would see no difference at all (spans are invisible to it).
    expect(padBottomWithSpans - padBottomBase).toBe(3 * 20)
  })
})
