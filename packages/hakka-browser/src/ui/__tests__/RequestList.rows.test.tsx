import { render, waitFor } from '@solidjs/testing-library'
import type { NetworkRequest, RequestGroup } from 'hakka-core'
import { deriveTraceId, groupRequests } from 'hakka-core'
import { describe, it, expect } from 'vitest'

import { RequestList } from '../RequestList'
import { makeGroup, makeReq, makeSpan, makeTraceHop } from './requestListFixtures'

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
