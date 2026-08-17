import { fireEvent, render } from '@solidjs/testing-library'
import type { TraceBadgeSummary } from 'hakka-core'
import { describe, expect, it, vi } from 'vitest'

import { TraceBadgeRow } from '../TraceBadgeRow'

function summary(overrides: Partial<TraceBadgeSummary> = {}): TraceBadgeSummary {
  return {
    method: 'POST',
    status: 200,
    requestKind: 'rsc',
    fetchCount: 3,
    cacheSummary: '2 HIT · 1 MISS',
    operationCount: 5,
    slowest: { label: '/checkout', durationMs: 420 },
    ...overrides,
  }
}

describe('TraceBadgeRow', () => {
  it('renders method/status/requestKind as pill tags', () => {
    const { container } = render(() => <TraceBadgeRow summary={summary()} verbose={false} onToggleVerbose={() => {}} />)
    const tags = Array.from(container.querySelectorAll('.hakka-rt-tag')).map((t) => t.textContent)
    expect(tags).toEqual(['POST', '200', 'rsc'])
  })

  it('omits method/status/requestKind pills when absent', () => {
    const { container } = render(() => (
      <TraceBadgeRow
        summary={summary({ method: null, status: null, requestKind: null })}
        verbose={false}
        onToggleVerbose={() => {}}
      />
    ))
    expect(container.querySelectorAll('.hakka-rt-tag')).toHaveLength(0)
  })

  it('renders fetchCount/operationCount via the shared .hakka-count-badge component, not a new class', () => {
    const { container } = render(() => <TraceBadgeRow summary={summary()} verbose={false} onToggleVerbose={() => {}} />)
    const badges = Array.from(container.querySelectorAll('.hakka-count-badge')).map((b) => b.textContent)
    expect(badges).toEqual(['3', '5'])
  })

  it('shows the cache summary and slowest-op sentence as plain prose', () => {
    const { container } = render(() => <TraceBadgeRow summary={summary()} verbose={false} onToggleVerbose={() => {}} />)
    const prose = Array.from(container.querySelectorAll('.hakka-trace-badge-prose')).map((p) => p.textContent)
    expect(prose[0]).toBe('2 HIT · 1 MISS')
    expect(prose[1]).toContain('/checkout')
    expect(prose[1]).toContain('420ms')
  })

  it('omits the slowest-op line when there is nothing to summarize', () => {
    const { container } = render(() => (
      <TraceBadgeRow summary={summary({ slowest: null })} verbose={false} onToggleVerbose={() => {}} />
    ))
    const prose = Array.from(container.querySelectorAll('.hakka-trace-badge-prose')).map((p) => p.textContent)
    expect(prose).toHaveLength(1) // cache summary only
  })

  it('the verbose toggle is a shared .hakka-switch and fires onToggleVerbose on click', () => {
    const onToggleVerbose = vi.fn()
    const { container } = render(() => (
      <TraceBadgeRow summary={summary()} verbose={false} onToggleVerbose={onToggleVerbose} />
    ))
    const toggle = container.querySelector('.hakka-switch') as HTMLElement
    expect(toggle).toBeTruthy()
    expect(toggle.className).not.toContain(' on')
    expect(container.querySelector('.hakka-switch-knob')).toBeTruthy()

    fireEvent.click(toggle)
    expect(onToggleVerbose).toHaveBeenCalledTimes(1)
  })

  it('reflects verbose=true with the .on modifier', () => {
    const { container } = render(() => <TraceBadgeRow summary={summary()} verbose={true} onToggleVerbose={() => {}} />)
    expect(container.querySelector('.hakka-switch.on')).toBeTruthy()
  })
})
