import { render } from '@solidjs/testing-library'
import type { FrameworkSpan, NetworkRequest, RequestGroup } from 'hakka-core'
import { deriveTraceId, groupRequests } from 'hakka-core'
import { describe, it, expect } from 'vitest'

import { RequestList } from '../RequestList'
import { makeGroup, makeReq, makeSpan, reqs } from './requestListFixtures'

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
