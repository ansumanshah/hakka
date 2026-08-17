/**
 * RequestRow — rows are read-only surfaces: method, path/host, badges,
 * status, timing. The "Copy as agent context" action lives ONLY in Detail
 * (Detail.agentContext.test.tsx) — an earlier iteration put a kebab menu on
 * every row plus an "Agent" pill on error rows, and on narrow containers the
 * pair squeezed the URL column into an unreadable ellipsis. These tests pin
 * the removal so the controls don't creep back into the row.
 */
import { render } from '@solidjs/testing-library'
import type { NetworkRequest } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { initStore, destroyStore } from '../../worker'
import { RequestRow } from '../RequestRow'

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'a',
    url: 'https://api.example.com/checkout',
    method: 'POST',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: {},
    ...over,
  } as NetworkRequest
}

beforeEach(() => {
  initStore({ forceInProcess: true })
})

afterEach(() => {
  destroyStore()
})

describe('RequestRow — content', () => {
  it('renders method, path, and host', () => {
    const { container } = render(() => <RequestRow req={req()} selected={false} onSelect={() => {}} />)
    expect(container.querySelector('.hakka-method-badge')?.textContent).toBe('POST')
    expect(container.querySelector('.hakka-row-path')?.textContent).toBe('/checkout')
    expect(container.querySelector('.hakka-row-host')?.textContent).toBe('api.example.com')
  })
})

describe('RequestRow — no per-row action controls', () => {
  it('renders no kebab menu on a healthy row', () => {
    const { container } = render(() => <RequestRow req={req()} selected={false} onSelect={() => {}} />)
    expect(container.querySelector('.hakka-menu')).toBeNull()
    expect(container.querySelector('[aria-label="Copy as agent context"]')).toBeNull()
  })

  it('renders no agent-context pill even on error rows (500 / network error)', () => {
    for (const r of [req({ status: 500 }), req({ status: 200, error: 'ECONNRESET' })]) {
      const { container, unmount } = render(() => <RequestRow req={r} selected={false} onSelect={() => {}} />)
      expect(container.querySelector('button.hakka-rt-tag')).toBeNull()
      expect(container.querySelector('[aria-label="Copy as agent context"]')).toBeNull()
      unmount()
    }
  })
})
