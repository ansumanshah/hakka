import { render, fireEvent } from '@solidjs/testing-library'
import type { NetworkRequest } from 'hakka-core'
import { afterEach, describe, it, expect, vi } from 'vitest'

import { Detail } from '../Detail'

afterEach(() => vi.unstubAllGlobals())

// Solid 2.0 batches signal writes to a microtask (see solid-2-playbook.md rule
// 4) — a plain `fireEvent.click` no longer applies its resulting DOM update
// synchronously, so tests that read the DOM right after a click need to flush
// past that microtask first.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'a',
    url: 'https://api.example.com/graphql',
    method: 'POST',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: {},
    ...over,
  } as NetworkRequest
}

describe('Detail — GraphQL', () => {
  it('shows the GraphQL operation in the overview', () => {
    const { container } = render(() => (
      <Detail req={req({ graphql: { operationType: 'query', operationName: 'GetUser' } })} onBack={() => {}} />
    ))
    expect(container.textContent).toContain('GraphQL')
    expect(container.textContent).toContain('GetUser')
  })
})

describe('Detail — Cache (Next Request Insights design doc feature 3)', () => {
  it('shows a Cache KVRow in the overview when cacheStatus is present', () => {
    const { container } = render(() => <Detail req={req({ cacheStatus: 'HIT' })} onBack={() => {}} />)
    expect(container.textContent).toContain('Cache')
    expect(container.textContent).toContain('HIT')
  })

  it('omits the Cache KVRow when cacheStatus is absent — no second, competing cache UI element', () => {
    const { container } = render(() => <Detail req={req()} onBack={() => {}} />)
    const rows = Array.from(container.querySelectorAll('td')).map((td) => td.textContent)
    expect(rows).not.toContain('Cache')
  })
})

describe('Detail — initiator', () => {
  it('shows the Initiator section with the call stack when present', () => {
    const stack = 'loadUser (app/user.tsx:12:5)\nonClick (app/button.tsx:8:3)'
    const { container } = render(() => <Detail req={req({ initiator: stack })} onBack={() => {}} />)
    expect(container.textContent).toContain('Initiator')
    expect(container.querySelector('.hakka-initiator')?.textContent).toContain('app/user.tsx:12:5')
  })

  it('omits the Initiator section when not captured', () => {
    const { container } = render(() => <Detail req={req()} onBack={() => {}} />)
    expect(container.querySelector('.hakka-initiator')).toBeNull()
  })
})

describe('Detail — WebSocket frames', () => {
  it('adds a Frames tab for WS requests and lists frames', async () => {
    const { container } = render(() => (
      <Detail
        req={req({
          url: 'wss://example.com/socket',
          source: 'websocket',
          messages: [
            { timestamp: Date.now(), direction: 'sent', data: 'ping', size: 4 },
            { timestamp: Date.now(), direction: 'received', data: 'pong', size: 4 },
          ],
        })}
        onBack={() => {}}
      />
    ))
    const msgTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) =>
      t.textContent?.includes('Frames'),
    ) as HTMLElement
    expect(msgTab).toBeTruthy()
    expect(msgTab.textContent).toContain('2')

    fireEvent.click(msgTab)
    await flush()
    const frames = container.querySelectorAll('.hakka-ws-msg')
    expect(frames.length).toBe(2)
    expect(container.textContent).toContain('ping')
    expect(container.textContent).toContain('pong')
  })

  it('does not show a Frames tab for plain HTTP requests', () => {
    const { container } = render(() => <Detail req={req({ source: 'fetch' })} onBack={() => {}} />)
    const msgTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) => t.textContent?.includes('Frames'))
    expect(msgTab).toBeUndefined()
  })
})

describe('Detail — replay', () => {
  it('re-issues the request via fetch with method/headers/body', () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(new Response('{}'))
    })
    const { container } = render(() => (
      <Detail
        req={req({
          url: 'https://x.com/p',
          method: 'POST',
          source: 'fetch',
          requestHeaders: { 'x-test': '1' },
          requestBody: '{"a":1}',
        })}
        onBack={() => {}}
      />
    ))
    const replayBtn = Array.from(container.querySelectorAll('.hakka-curl-btn')).find((b) =>
      /replay/i.test(b.textContent ?? ''),
    ) as HTMLElement
    expect(replayBtn).toBeTruthy()
    fireEvent.click(replayBtn)
    expect(calls.length).toBe(1)
    expect(calls[0]?.url).toBe('https://x.com/p')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toBe('{"a":1}')
  })

  it('hides Replay for WebSocket requests', () => {
    const { container } = render(() => (
      <Detail req={req({ url: 'wss://x.com', source: 'websocket', messages: [] })} onBack={() => {}} />
    ))
    const replayBtn = Array.from(container.querySelectorAll('.hakka-curl-btn')).find((b) =>
      /replay/i.test(b.textContent ?? ''),
    )
    expect(replayBtn).toBeUndefined()
  })
})

describe('Detail — Cookies tab', () => {
  it('shows a Cookies tab and renders parsed Set-Cookie attributes', async () => {
    const { container } = render(() => (
      <Detail
        req={req({
          requestHeaders: { Cookie: 'session=abc123; theme=dark' },
          responseHeaders: {
            'Set-Cookie': 'token=xyz; Path=/; HttpOnly; Secure; SameSite=Lax',
          },
        })}
        onBack={() => {}}
      />
    ))
    const cookiesTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) =>
      t.textContent?.includes('Cookies'),
    ) as HTMLElement
    expect(cookiesTab).toBeTruthy()

    fireEvent.click(cookiesTab)
    await flush()
    expect(container.textContent).toContain('session')
    expect(container.textContent).toContain('abc123')
    expect(container.textContent).toContain('token')
    expect(container.textContent).toContain('xyz')
    expect(container.textContent).toContain('HttpOnly')
    expect(container.textContent).toContain('Secure')
    expect(container.textContent).toContain('SameSite=Lax')
  })

  it('does not show a Cookies tab when no cookies exist', () => {
    const { container } = render(() => <Detail req={req()} onBack={() => {}} />)
    const cookiesTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) =>
      t.textContent?.includes('Cookies'),
    )
    expect(cookiesTab).toBeUndefined()
  })
})

describe('Detail — GraphQL tab', () => {
  it('adds a GraphQL tab when req.graphql is set', async () => {
    const { container } = render(() => (
      <Detail
        req={req({
          graphql: { operationType: 'query', operationName: 'GetUser', variables: { id: '1' } },
        })}
        onBack={() => {}}
      />
    ))
    const gqlTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) =>
      t.textContent?.includes('GraphQL'),
    ) as HTMLElement
    expect(gqlTab).toBeTruthy()

    fireEvent.click(gqlTab)
    expect(container.textContent).toContain('query')
    expect(container.textContent).toContain('GetUser')
    // Variables rendered as a JSON tree — JsonViewer is lazy, so await the chunk.
    const deadline = Date.now() + 2000
    while (container.querySelector('.hakka-json') === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(container.querySelector('.hakka-json')).not.toBeNull()
  })

  it('shows the Query section, parsed from the request body, above Variables', async () => {
    const query = 'query GetUser($id: ID!) {\n  user(id: $id) {\n    name\n  }\n}'
    const { container } = render(() => (
      <Detail
        req={req({
          graphql: { operationType: 'query', operationName: 'GetUser', variables: { id: '1' } },
          requestBody: JSON.stringify({ operationName: 'GetUser', query, variables: { id: '1' } }),
        })}
        onBack={() => {}}
      />
    ))
    const gqlTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) =>
      t.textContent?.includes('GraphQL'),
    ) as HTMLElement
    fireEvent.click(gqlTab)
    await flush()
    expect(container.textContent).toContain('Query')
    expect(container.textContent).toContain('user(id: $id)')
    // Query appears before Variables in the section order. Read via
    // textContent, not innerHTML — Solid 2's dom-expressions inserts marker
    // comments (`<!---->`) between adjacent static/dynamic JSX text children
    // (verified against a minimal repro), which splits a literal substring
    // like `"id"` apart in the serialized HTML even though it reads
    // contiguously as text.
    const text = container.textContent ?? ''
    expect(text.indexOf('user(id: $id)')).toBeLessThan(text.indexOf('"id"'))
  })

  it('omits the Query section when the request body is missing (e.g. a persisted-query request)', async () => {
    const { container } = render(() => (
      <Detail req={req({ graphql: { operationType: 'query', operationName: 'GetUser' } })} onBack={() => {}} />
    ))
    const gqlTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) =>
      t.textContent?.includes('GraphQL'),
    ) as HTMLElement
    fireEvent.click(gqlTab)
    await flush()
    expect(
      Array.from(container.querySelectorAll('.hakka-section-title')).some((el) => el.textContent === 'Query'),
    ).toBe(false)
    expect(container.textContent).toContain('No variables')
  })

  it('omits the Query section when the request body is truncated/not valid JSON', () => {
    const { container } = render(() => (
      <Detail
        req={req({
          graphql: { operationType: 'query', operationName: 'GetUser' },
          requestBody: '{"operationName":"GetUser","query":"query GetUser { us',
        })}
        onBack={() => {}}
      />
    ))
    const gqlTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) =>
      t.textContent?.includes('GraphQL'),
    ) as HTMLElement
    fireEvent.click(gqlTab)
    expect(
      Array.from(container.querySelectorAll('.hakka-section-title')).some((el) => el.textContent === 'Query'),
    ).toBe(false)
  })

  it('does not show a GraphQL tab for plain HTTP requests', () => {
    const { container } = render(() => <Detail req={req()} onBack={() => {}} />)
    const gqlTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) => t.textContent?.includes('GraphQL'))
    expect(gqlTab).toBeUndefined()
  })

  it('shows "No variables" when variables object is empty', async () => {
    const { container } = render(() => (
      <Detail req={req({ graphql: { operationType: 'mutation', operationName: 'CreatePost' } })} onBack={() => {}} />
    ))
    const gqlTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) =>
      t.textContent?.includes('GraphQL'),
    ) as HTMLElement
    fireEvent.click(gqlTab)
    await flush()
    expect(container.textContent).toContain('No variables')
  })

  it('renders GraphQL Errors block when response body has top-level errors array', async () => {
    const responseBody = JSON.stringify({
      data: null,
      errors: [{ message: 'User not found', path: ['user', 'id'] }, { message: 'Permission denied' }],
    })
    const { container } = render(() => (
      <Detail
        req={req({
          graphql: { operationType: 'query', operationName: 'GetUser' },
          responseBody,
        })}
        onBack={() => {}}
      />
    ))
    const gqlTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) =>
      t.textContent?.includes('GraphQL'),
    ) as HTMLElement
    fireEvent.click(gqlTab)
    await flush()
    expect(container.textContent).toContain('GraphQL Errors')
    expect(container.textContent).toContain('User not found')
    expect(container.textContent).toContain('Permission denied')
    expect(container.textContent).toContain('user')
  })

  it('does not render GraphQL Errors block when response has no errors', () => {
    const responseBody = JSON.stringify({ data: { user: { id: '1' } } })
    const { container } = render(() => (
      <Detail
        req={req({
          graphql: { operationType: 'query', operationName: 'GetUser' },
          responseBody,
        })}
        onBack={() => {}}
      />
    ))
    const gqlTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) =>
      t.textContent?.includes('GraphQL'),
    ) as HTMLElement
    fireEvent.click(gqlTab)
    expect(container.textContent).not.toContain('GraphQL Errors')
  })
})

describe('Detail — status/error precedence (P5 B2 audit Finding 3)', () => {
  // Cross-platform rule (re-affirmed on iOS): the error SIGNAL always wins for
  // severity styling — a status-200 request with a non-nil `error` must still
  // read as errored — while status TEXT is shown plainly, never replaced by
  // the error sentence.

  it('status pill: colors red (error) even when status is 200, but keeps the status code as text', () => {
    const { container } = render(() => <Detail req={req({ status: 200, error: 'ECONNRESET' })} onBack={() => {}} />)
    // The header row (shared RequestRow) carries the status pill.
    const pill = container.querySelector('.hakka-detail-rowback .hakka-status')
    expect(pill?.classList.contains('status-error')).toBe(true)
    expect(pill?.textContent).toBe('200')
  })

  it('status pill: falls back to ERR only when there is no status code at all', () => {
    const { container } = render(() => (
      <Detail req={req({ status: undefined, error: 'network error' })} onBack={() => {}} />
    ))
    const pill = container.querySelector('.hakka-detail-rowback .hakka-status')
    expect(pill?.classList.contains('status-error')).toBe(true)
    expect(pill?.textContent).toBe('ERR')
  })

  it('Overview: shows both Status and a distinct Error row when status is 200 and error is set (error not swallowed)', () => {
    const { container } = render(() => <Detail req={req({ status: 200, error: 'ECONNRESET' })} onBack={() => {}} />)
    const rows = Array.from(container.querySelectorAll('.hakka-kv-table tr')).map((tr) => ({
      k: tr.querySelector('.hakka-kv-key')?.textContent,
      v: tr.querySelector('.hakka-kv-value')?.textContent,
    }))
    expect(rows).toContainEqual({ k: 'Status', v: '200' })
    expect(rows).toContainEqual({ k: 'Error', v: 'ECONNRESET' })
  })

  it('Overview: omits the Error row entirely when there is no error', () => {
    const { container } = render(() => <Detail req={req({ status: 200 })} onBack={() => {}} />)
    const keys = Array.from(container.querySelectorAll('.hakka-kv-table .hakka-kv-key')).map((td) => td.textContent)
    expect(keys).not.toContain('Error')
  })

  it('Overview: shows Pending status and no Error row before a response or error has landed', () => {
    const { container } = render(() => <Detail req={req({ status: undefined })} onBack={() => {}} />)
    const rows = Array.from(container.querySelectorAll('.hakka-kv-table tr')).map((tr) => ({
      k: tr.querySelector('.hakka-kv-key')?.textContent,
      v: tr.querySelector('.hakka-kv-value')?.textContent,
    }))
    expect(rows).toContainEqual({ k: 'Status', v: 'Pending' })
    expect(keysOf(rows)).not.toContain('Error')
  })
})

function keysOf(rows: { k?: string | null; v?: string | null }[]): (string | null | undefined)[] {
  return rows.map((r) => r.k)
}

describe('Detail — URL decode toggle', () => {
  it('shows a decode toggle for percent-encoded URLs and reveals the decoded line on click', async () => {
    const { container } = render(() => (
      <Detail req={req({ url: 'https://api.example.com/search?q=hello%20world&lang=en%2Fus' })} onBack={() => {}} />
    ))
    const decodeBtn = container.querySelector('.hakka-detail-status [aria-pressed]') as HTMLElement
    expect(decodeBtn?.textContent).toBe('Decode URL')
    expect(container.querySelector('.hakka-detail-decoded')).toBeNull()

    fireEvent.click(decodeBtn)
    await flush()

    const decoded = container.querySelector('.hakka-detail-decoded')
    expect(decoded?.textContent).toContain('hello world')
  })

  it('does not show a decode toggle for plain URLs', () => {
    const { container } = render(() => <Detail req={req({ url: 'https://api.example.com/users' })} onBack={() => {}} />)
    const decodeBtn = Array.from(container.querySelectorAll('.hakka-curl-btn')).find(
      (b) => b.textContent === 'Decode URL',
    )
    expect(decodeBtn).toBeUndefined()
  })
})
