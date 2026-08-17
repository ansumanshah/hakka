/**
 * Detail — "Copy as agent context" button. Behavioral, not a click-count
 * smoke test: asserts the clipboard actually receives a well-formed
 * evidence-bundle payload (preamble + fenced JSON, focused on the selected
 * request), matching the design's UI/MCP payload-parity claim.
 */
import { render, fireEvent } from '@solidjs/testing-library'
import type { NetworkRequest } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { copyToClipboard } from '../../adapters/clipboard'
import { initStore, destroyStore } from '../../worker'
import { Detail } from '../Detail'

vi.mock('../../adapters/clipboard', () => ({
  copyToClipboard: vi.fn(async () => true),
}))

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'a',
    url: 'https://api.example.com/checkout',
    method: 'POST',
    status: 500,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: {},
    ...over,
  } as NetworkRequest
}

beforeEach(() => {
  initStore({ forceInProcess: true })
  vi.mocked(copyToClipboard).mockClear()
})

afterEach(() => {
  destroyStore()
})

// The toolbar went icon-forward (IconSparkle + "Agent") — aria-label is the
// one thing required to stay exactly "Copy as agent context" (task #22), so
// that's what tests key off instead of visible text.
function findAgentContextButton(container: HTMLElement): HTMLElement {
  const btn = container.querySelector('.hakka-curl-btn[aria-label="Copy as agent context"]')
  if (!btn) throw new Error('no button found with aria-label "Copy as agent context"')
  return btn as HTMLElement
}

describe('Detail — Copy as agent context', () => {
  it('copies a fenced-JSON evidence bundle focused on this request', async () => {
    const { container } = render(() => <Detail req={req()} onBack={() => {}} />)

    fireEvent.click(findAgentContextButton(container))
    await Promise.resolve()
    await Promise.resolve()

    expect(copyToClipboard).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(copyToClipboard).mock.calls[0]![0]
    expect(payload).toContain('```json')
    const bundle = JSON.parse(payload.slice(payload.indexOf('```json') + 7, payload.lastIndexOf('```'))) as {
      focusRequestId: string
      version: number
    }
    expect(bundle.focusRequestId).toBe('a')
    expect(bundle.version).toBe(1)
  })

  it('is visible even for a WebSocket request (unlike Replay, which hides)', () => {
    const { container } = render(() => (
      <Detail req={req({ url: 'wss://x.com', source: 'websocket', messages: [] })} onBack={() => {}} />
    ))
    expect(() => findAgentContextButton(container)).not.toThrow()
  })
})
