/**
 * Detail — LLM surfaces: the provider badge on rows (URL-only detection,
 * slim-row-safe), the Overview Usage section (tokens + model, parsed from
 * the body fetched via the store getBody path — never the slim mirror), and
 * the SSE tab for event-stream responses (assembled message + raw events).
 * All bodies below come from the pinned wire fixtures in fixtures/sse/.
 */
import { render, fireEvent } from '@solidjs/testing-library'
import type { NetworkRequest } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initStore, destroyStore, type StoreClient } from '../../worker'
import { Detail } from '../Detail'
import { readSseFixture } from '../llm/__tests__/sseFixtures'
import { RequestRow } from '../RequestRow'

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'd1',
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: {},
    ...over,
  }
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function clickTab(container: HTMLElement, label: string): void {
  const btn = Array.from(container.querySelectorAll('.hakka-tab')).find((t) => t.textContent === label) as HTMLElement
  fireEvent.click(btn)
}

let client: StoreClient

beforeEach(() => {
  client = initStore({ forceInProcess: true })
})

afterEach(() => {
  destroyStore()
  vi.restoreAllMocks()
})

describe('RequestRow — LLM provider badge', () => {
  it('badges a known LLM host from the URL alone (no body fetch on the row)', () => {
    const { container } = render(() => (
      <RequestRow
        req={req({ url: 'https://api.openai.com/v1/chat/completions' })}
        selected={false}
        onSelect={() => {}}
      />
    ))
    const badge = container.querySelector('.hakka-llm-tag')
    expect(badge?.textContent).toBe('OpenAI')
  })

  it('badges no non-LLM host', () => {
    const { container } = render(() => <RequestRow req={req()} selected={false} onSelect={() => {}} />)
    expect(container.querySelector('.hakka-llm-tag')).toBeNull()
  })
})

describe('Detail — LLM Usage section (Overview)', () => {
  it('renders tokens + model from the store-hydrated body of a streamed OpenAI response', async () => {
    client.ingest(
      req({
        id: 'llm-usage-1',
        url: 'https://api.openai.com/v1/chat/completions',
        responseHeaders: { 'content-type': 'text/event-stream' },
        responseBody: readSseFixture('openai-chat-chunks.sse'),
      }),
    )
    // Slim mirror — the row Detail actually receives (no bodies).
    const slim = req({
      id: 'llm-usage-1',
      url: 'https://api.openai.com/v1/chat/completions',
      responseHeaders: { 'content-type': 'text/event-stream' },
    })
    const { container } = render(() => <Detail req={slim} onBack={() => {}} />)

    await waitFor(() => container.textContent?.includes('Usage · OpenAI') ?? false)
    expect(container.textContent).toContain('gpt-4o-2024-08-06')
    expect(container.textContent).toContain('Prompt tokens')
    expect(container.textContent).toContain('25')
    expect(container.textContent).toContain('Completion tokens')
    expect(container.textContent).toContain('48')
    expect(container.textContent).toContain('73') // total
  })

  it('stays absent for a non-LLM host even with a body present', async () => {
    client.ingest(req({ id: 'llm-usage-2', responseBody: '{"usage":{"prompt_tokens":1}}' }))
    const slim = req({ id: 'llm-usage-2' })
    const { container } = render(() => <Detail req={slim} onBack={() => {}} />)
    // Give the (resolving) body fetch a chance to land before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container.textContent).not.toContain('Usage ·')
  })
})

describe('Detail — SSE tab', () => {
  function sseReq(over: Partial<NetworkRequest> = {}): NetworkRequest {
    return req({
      id: 'sse-1',
      url: 'https://api.anthropic.com/v1/messages',
      responseHeaders: { 'content-type': 'text/event-stream' },
      ...over,
    })
  }

  it('appears only for event-stream content types', () => {
    const withSse = render(() => <Detail req={sseReq()} onBack={() => {}} />)
    expect(withSse.container.textContent).toContain('SSE')
    withSse.unmount()

    const plain = render(() => <Detail req={req({ responseBody: '{"ok":true}' })} onBack={() => {}} />)
    expect(plain.container.textContent).not.toContain('SSE')
    plain.unmount()
  })

  it('renders the assembled Anthropic message, tool call, and raw event list with counts', async () => {
    client.ingest(sseReq({ responseBody: readSseFixture('anthropic-messages.sse') }))
    const slim = sseReq()
    const { container } = render(() => <Detail req={slim} onBack={() => {}} />)

    clickTab(container, 'SSE')
    await waitFor(() => container.textContent?.includes('Assembled message') ?? false)

    expect(container.textContent).toContain('The capital of France is Paris.')
    expect(container.textContent).toContain('get_weather')
    expect(container.textContent).toContain('"unit": "celsius"') // arguments pretty-printed
    expect(container.textContent).toContain('claude-sonnet-4-5-20250929')
    expect(container.textContent).toContain('tool_use')
    expect(container.textContent).toContain('12 events')
    expect(container.textContent).toContain('Raw events (12)')
    expect(container.textContent).toContain('message_start')
  })

  it('renders the raw event list alone for a plain (non-LLM) event stream', async () => {
    client.ingest(
      req({
        id: 'sse-plain',
        url: 'https://api.example.com/progress',
        responseHeaders: { 'content-type': 'text/event-stream' },
        responseBody: readSseFixture('plain-events.sse'),
      }),
    )
    const slim = req({
      id: 'sse-plain',
      url: 'https://api.example.com/progress',
      responseHeaders: { 'content-type': 'text/event-stream' },
    })
    const { container } = render(() => <Detail req={slim} onBack={() => {}} />)

    clickTab(container, 'SSE')
    await waitFor(() => container.textContent?.includes('Raw events') ?? false)
    expect(container.textContent).not.toContain('Assembled message')
    expect(container.textContent).toContain('4 events')
    expect(container.textContent).toContain('"state":"running","progress":0.25')
  })
})
