import { fireEvent, render } from '@solidjs/testing-library'
import type { FrameworkSpan, NetworkRequest, RequestGroup } from 'hakka-core'
import { describe, it, expect, vi } from 'vitest'

import { TraceWaterfall } from '../TraceWaterfall'

function hop(id: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest {
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

function span(id: string, overrides: Partial<FrameworkSpan> = {}): FrameworkSpan {
  return {
    id,
    traceId: 'trace_checkout',
    parentId: null,
    name: 'BaseServer.handleRequest',
    startTime: 0,
    endTime: 10,
    verbosity: 'primary',
    runtime: 'server',
    ...overrides,
  }
}

/** A checkout trace: client call, a nested server hop, a deeper upstream hop. */
function checkoutTrace(): RequestGroup {
  return {
    key: 'trace_checkout',
    label: 'Trace trace_ch',
    items: [
      hop('client', { runtime: 'client', method: 'POST', startTime: 1000, endTime: 1420, duration: 420 }),
      hop('server', { runtime: 'server', method: 'POST', startTime: 1055, endTime: 1360, duration: 305 }),
      hop('upstream', { runtime: 'server', startTime: 1090, endTime: 1210, duration: 120 }),
    ],
  }
}

const qa = (c: Element, sel: string) => Array.from(c.querySelectorAll(sel))

describe('TraceWaterfall', () => {
  it('renders one hop per item, sorted by start time', () => {
    const { container } = render(() => <TraceWaterfall group={checkoutTrace()} selectedId={null} onSelect={() => {}} />)
    // One name column per row (method + path) — runtime lives once in the
    // legend; the dot (tinted via the row's rt-* class) carries it instead.
    const names = qa(container, '.hakka-wf-name').map((e) => e.textContent)
    expect(names).toEqual(['POST /client', 'POST /server', 'GET /upstream'])
  })

  it('places each hop on one shared axis — offset + width are fractions of the trace span', () => {
    // span = latest end (1420) − earliest start (1000) = 420ms.
    const { container } = render(() => <TraceWaterfall group={checkoutTrace()} selectedId={null} onSelect={() => {}} />)
    const bars = qa(container, '.hakka-wf-bar').map((b) => ({
      left: (b as HTMLElement).style.left,
      width: (b as HTMLElement).style.width,
    }))
    expect(bars).toEqual([
      { left: '0.00%', width: '100.00%' }, // client spans the whole trace
      { left: '13.10%', width: '72.62%' }, // server nested inside
      { left: '21.43%', width: '28.57%' }, // upstream nested deeper
    ])
  })

  it('tags each hop with its runtime and status tone', () => {
    const group: RequestGroup = {
      key: 't',
      label: 'Trace t',
      items: [
        hop('a', { runtime: 'client', startTime: 0, endTime: 100, duration: 100 }),
        hop('b', { runtime: 'edge', status: 404, startTime: 10, endTime: 60, duration: 50 }),
        hop('c', { runtime: 'server', status: 500, startTime: 20, endTime: 90, duration: 70 }),
      ],
    }
    const { container } = render(() => <TraceWaterfall group={group} selectedId={null} onSelect={() => {}} />)
    const cls = qa(container, '.hakka-wf-hop').map((h) => h.className)
    expect(cls[0]).toContain('rt-client')
    expect(cls[0]).toContain('tone-success')
    expect(cls[1]).toContain('rt-edge')
    expect(cls[1]).toContain('tone-warning') // 4xx
    expect(cls[2]).toContain('rt-server')
    expect(cls[2]).toContain('tone-error') // 5xx
  })

  it('marks a pending hop (no end, no duration) with a min-width bar and pending tone', () => {
    const group: RequestGroup = {
      key: 't',
      label: 'Trace t',
      items: [
        hop('done', { startTime: 0, endTime: 200, duration: 200 }),
        hop('pending', { status: null, startTime: 50, endTime: undefined, duration: null }),
      ],
    }
    const { container } = render(() => <TraceWaterfall group={group} selectedId={null} onSelect={() => {}} />)
    const cls = qa(container, '.hakka-wf-hop').map((h) => h.className)
    expect(cls[1]).toContain('tone-pending')
    // Zero-length hop floors to the 2% visible minimum so it stays clickable.
    const bars = qa(container, '.hakka-wf-bar').map((b) => (b as HTMLElement).style.width)
    expect(bars[1]).toBe('2.00%')
  })

  it('selects the clicked hop and reflects the selectedId', () => {
    const onSelect = vi.fn()
    const group = checkoutTrace()
    const { container } = render(() => <TraceWaterfall group={group} selectedId="server" onSelect={onSelect} />)
    const hops = qa(container, '.hakka-wf-hop')
    const cls = hops.map((h) => h.className)
    // selectedId='server' → the second hop carries the selected class.
    expect(cls[1]).toContain('selected')
    expect(cls[0]).not.toContain('selected')

    const upstreamHop = hops[2]
    if (!upstreamHop) throw new Error('expected 3 hops')
    fireEvent.click(upstreamHop)
    expect(onSelect).toHaveBeenCalledTimes(1)
    const firstCallArg = onSelect.mock.calls[0]?.[0] as NetworkRequest | undefined
    expect(firstCallArg?.id).toBe('upstream')
  })

  it('never divides by zero when every hop is instantaneous', () => {
    const group: RequestGroup = {
      key: 't',
      label: 'Trace t',
      items: [hop('a', { startTime: 5, endTime: 5, duration: 0 }), hop('b', { startTime: 5, endTime: 5, duration: 0 })],
    }
    const { container } = render(() => <TraceWaterfall group={group} selectedId={null} onSelect={() => {}} />)
    const bars = qa(container, '.hakka-wf-bar').map((b) => (b as HTMLElement).style.width)
    // span guarded to 1ms → widths finite, floored to the 2% minimum.
    expect(bars).toEqual(['2.00%', '2.00%'])
  })
})

describe('TraceWaterfall — framework spans (Next Request Insights design doc §5, feature 2)', () => {
  it('renders a span bar alongside hop bars, tagged .kind-span', () => {
    const group = checkoutTrace()
    const spans = [span('root', { startTime: 1000, endTime: 1420 })]
    const { container } = render(() => (
      <TraceWaterfall group={group} selectedId={null} onSelect={() => {}} spans={spans} />
    ))
    const bars = qa(container, '.hakka-wf-hop')
    // 3 hops + 1 span (default verbose=false, and the fixture span is 'primary').
    expect(bars).toHaveLength(4)
    expect(bars.filter((b) => b.className.includes('kind-span'))).toHaveLength(1)
  })

  it('indents a nested span by its parentId chain (depth)', () => {
    const group: RequestGroup = { key: 'trace-x', label: 'Trace x', items: [] }
    const spans = [
      span('root', { id: 'root', parentId: null, startTime: 0, endTime: 100 }),
      span('child', { id: 'child', parentId: 'root', startTime: 10, endTime: 90 }),
    ]
    const { container } = render(() => (
      <TraceWaterfall group={group} selectedId={null} onSelect={() => {}} spans={spans} />
    ))
    const bars = qa(container, '.hakka-wf-hop') as HTMLElement[]
    expect(bars).toHaveLength(2)
    // Indent is `calc(var(--hakka-space-lg) * var(--wf-depth, 0))` in
    // styles.ts's `.kind-span` rule, not a hardcoded px value (DESIGN.md /
    // ui-token-check.mjs's no-hardcoded-spacing rule). Assert on the custom
    // property, not the resolved `marginLeft` — happy-dom doesn't resolve
    // `calc(var())`.
    expect(bars[0]!.style.getPropertyValue('--wf-depth')).toBe('')
    expect(bars[1]!.style.getPropertyValue('--wf-depth')).toBe('1')
  })

  it('filters verbose spans out by default and shows them when verbose=true', () => {
    const group: RequestGroup = { key: 'trace-y', label: 'Trace y', items: [] }
    const spans = [
      span('primary-1', { id: 'primary-1', verbosity: 'primary' }),
      span('verbose-1', { id: 'verbose-1', verbosity: 'verbose' }),
    ]
    const { container: quiet } = render(() => (
      <TraceWaterfall group={group} selectedId={null} onSelect={() => {}} spans={spans} verbose={false} />
    ))
    expect(qa(quiet, '.hakka-wf-hop')).toHaveLength(1)

    const { container: loud } = render(() => (
      <TraceWaterfall group={group} selectedId={null} onSelect={() => {}} spans={spans} verbose={true} />
    ))
    expect(qa(loud, '.hakka-wf-hop')).toHaveLength(2)
  })

  it('folds the requestKind of a synthetic root span (no backing NetworkRequest) into its name', () => {
    const group: RequestGroup = { key: 'trace-z', label: 'Trace z', items: [] }
    const spans = [span('root', { id: 'root', parentId: null, requestKind: 'rsc' })]
    const { container } = render(() => (
      <TraceWaterfall group={group} selectedId={null} onSelect={() => {}} spans={spans} />
    ))
    // The kind has no separate element — it's appended to the name column.
    expect(container.querySelector('.hakka-wf-name')?.textContent).toBe('BaseServer.handleRequest · rsc')
  })

  it('a span bar click is a no-op — only request bars are selectable', () => {
    const onSelect = vi.fn()
    const group: RequestGroup = { key: 'trace-w', label: 'Trace w', items: [] }
    const spans = [span('root')]
    const { container } = render(() => (
      <TraceWaterfall group={group} selectedId={null} onSelect={onSelect} spans={spans} />
    ))
    fireEvent.click(container.querySelector('.hakka-wf-hop')!)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('degrades to hop-only rendering when spans is omitted — [] is a fully valid input', () => {
    const { container } = render(() => <TraceWaterfall group={checkoutTrace()} selectedId={null} onSelect={() => {}} />)
    expect(qa(container, '.hakka-wf-hop')).toHaveLength(3)
    expect(qa(container, '.kind-span')).toHaveLength(0)
  })
})
