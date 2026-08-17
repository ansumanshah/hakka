/**
 * Detail — Share consolidation (task #26). Share used to be its own peer
 * toolbar button next to the "Copy as" dropdown, Replay, "Mock this", and the
 * sparkle Agent button — a redundant fifth control doing a clipboard/share
 * job the dropdown already exists for. It now lives as an item inside the
 * "Copy as ▾" dropdown, with its exact prior behavior (Web Share API, falling
 * back to clipboard) preserved.
 */
import { render, fireEvent } from '@solidjs/testing-library'
import type { NetworkRequest } from 'hakka-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { shareText } from '../../adapters/share'
import { Detail } from '../Detail'

vi.mock('../../adapters/share', () => ({
  shareText: vi.fn(async () => true),
}))

afterEach(() => {
  vi.mocked(shareText).mockClear()
})

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

describe('Detail — Share lives inside the Copy as ▾ dropdown', () => {
  it('is no longer a standalone peer toolbar button', () => {
    const { container } = render(() => <Detail req={req()} onBack={() => {}} />)
    const peerShare = Array.from(container.querySelectorAll('.hakka-curl-btn')).find(
      (b) => b.textContent?.trim() === 'Share',
    )
    expect(peerShare).toBeUndefined()
  })

  it('appears as an item inside .hakka-menu-list and shares the request text', async () => {
    const { container } = render(() => (
      <Detail req={req({ url: 'https://x.com/p', method: 'GET' })} onBack={() => {}} />
    ))
    const shareBtn = Array.from(container.querySelectorAll('.hakka-menu-list .hakka-btn')).find(
      (b) => b.textContent?.trim() === 'Share',
    ) as HTMLElement
    expect(shareBtn).toBeTruthy()

    fireEvent.click(shareBtn)
    await Promise.resolve()
    await Promise.resolve()

    expect(shareText).toHaveBeenCalledTimes(1)
    const call = vi.mocked(shareText).mock.calls[0]![0]
    expect(call.title).toBe('GET https://x.com/p')
    expect(call.text).toContain('GET https://x.com/p')
  })

  it('the sparkle Agent button remains a standalone peer button (only Share moved)', () => {
    const { container } = render(() => <Detail req={req()} onBack={() => {}} />)
    const agentBtn = container.querySelector('.hakka-curl-btn[aria-label="Copy as agent context"]')
    expect(agentBtn).toBeTruthy()
  })
})
