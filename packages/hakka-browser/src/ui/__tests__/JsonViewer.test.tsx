import { render, fireEvent } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, it, expect, vi, afterEach } from 'vitest'

import { JsonViewer } from '../JsonViewer'

afterEach(() => vi.restoreAllMocks())

// The search query is debounced ~150ms behind the input — post-input
// assertions must waitFor the debounced effect instead of reading synchronously.
async function waitFor(check: () => void, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      check()
      return
    } catch (e) {
      if (Date.now() > deadline) throw e
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

describe('JsonViewer', () => {
  it('renders a collapsible tree for small valid JSON', () => {
    const { container } = render(() => <JsonViewer text='{"name":"hakka","version":1}' />)
    expect(container.querySelector('.hakka-json')).not.toBeNull()
    const nodes = container.querySelectorAll('.hakka-json-node')
    expect(nodes.length).toBeGreaterThan(0)
    expect(container.querySelector('.hakka-body-pre')).toBeNull()
  })

  it('collapses objects at depth >= 2 by default', () => {
    const deep = JSON.stringify({ a: { b: { c: 'deep' } } })
    const { container } = render(() => <JsonViewer text={deep} />)
    expect(container.querySelector('.hakka-json')).not.toBeNull()
    expect(container.querySelector('.hakka-json-ellipsis')).not.toBeNull()
  })

  it('renders preview + reveal button for payloads > 50KB, not the tree', () => {
    const big = JSON.stringify({ data: 'x'.repeat(51_000) })
    expect(big.length).toBeGreaterThan(50_000)

    const { container } = render(() => <JsonViewer text={big} />)

    expect(container.querySelector('.hakka-json')).toBeNull()

    const pre = container.querySelector('.hakka-body-pre')
    expect(pre).not.toBeNull()
    // Preview is truncated to ~2KB
    expect((pre as HTMLElement).textContent!.length).toBeLessThanOrEqual(2_100)

    const btn = container.querySelector('button')
    expect(btn).not.toBeNull()
    expect(btn!.textContent).toMatch(/Show raw/i)
  })

  it('skips JSON.parse entirely for payloads > 50KB (goes straight to raw fallback)', () => {
    const big = JSON.stringify({ data: 'z'.repeat(51_000) })
    const parseSpy = vi.spyOn(JSON, 'parse')

    const { container } = render(() => <JsonViewer text={big} />)

    // The large-body path never calls JSON.parse — isLarge() short-circuits it.
    expect(parseSpy).not.toHaveBeenCalled()

    expect(container.querySelector('.hakka-json')).toBeNull()
    const pre = container.querySelector('.hakka-body-pre')
    expect(pre).not.toBeNull()
    expect((pre as HTMLElement).textContent!.length).toBeLessThanOrEqual(2_100)
    expect(container.querySelector('button')?.textContent).toMatch(/Show raw/i)
  })

  it('reveal button swaps to full raw text', async () => {
    const big = JSON.stringify({ data: 'y'.repeat(51_000) })
    const { container } = render(() => <JsonViewer text={big} />)

    const btn = container.querySelector('button') as HTMLButtonElement
    btn.click()

    await Promise.resolve()
    const pre = container.querySelector('.hakka-body-pre') as HTMLElement
    expect(pre.textContent!.length).toBeGreaterThan(50_000)
    expect(container.querySelector('button')).toBeNull()
  })

  it('falls back to <pre> for invalid JSON', () => {
    const bad = 'not json at all { broken'
    const { container } = render(() => <JsonViewer text={bad} />)

    expect(container.querySelector('.hakka-json')).toBeNull()
    const pre = container.querySelector('.hakka-body-pre')
    expect(pre).not.toBeNull()
    expect((pre as HTMLElement).textContent).toBe(bad)
  })

  it('renders no-body placeholder for null/empty text', () => {
    const { container } = render(() => <JsonViewer text={null} />)
    expect(container.querySelector('.hakka-empty-hint')).not.toBeNull()
  })
})

describe('JsonViewer — search', () => {
  it('shows a plain, neutral search input above the tree (no query language, no tint at rest)', () => {
    const { container } = render(() => <JsonViewer text='{"name":"hakka"}' />)
    const input = container.querySelector('.hakka-json-search') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.tagName).toBe('INPUT')
    expect(input.classList.contains('match')).toBe(false)
    expect(input.classList.contains('no-match')).toBe(false)
  })

  it('omits the search input entirely for the large-payload preview fallback', () => {
    const big = JSON.stringify({ data: 'x'.repeat(51_000) })
    const { container } = render(() => <JsonViewer text={big} />)
    expect(container.querySelector('.hakka-json-search')).toBeNull()
  })

  it('highlights a matching value and tints the border jade when matches exist', async () => {
    const { container } = render(() => <JsonViewer text='{"greeting":"hello world"}' />)
    const input = container.querySelector('.hakka-json-search') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'hello' } })

    await waitFor(() => {
      expect(container.querySelector('.hakka-json-mark')?.textContent?.toLowerCase()).toBe('hello')
      expect(input.classList.contains('match')).toBe(true)
      expect(input.classList.contains('no-match')).toBe(false)
    })
  })

  it('tints the border turmeric when the query has zero matches', async () => {
    const { container } = render(() => <JsonViewer text='{"greeting":"hello world"}' />)
    const input = container.querySelector('.hakka-json-search') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'zzz_nomatch' } })

    await waitFor(() => {
      expect(input.classList.contains('no-match')).toBe(true)
      expect(input.classList.contains('match')).toBe(false)
      expect(container.querySelector('.hakka-json-mark')).toBeNull()
    })
  })

  it('matches case-insensitively against both keys and values', async () => {
    const { container } = render(() => <JsonViewer text='{"userName":"Ansuman"}' />)
    const input = container.querySelector('.hakka-json-search') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'USERNAME' } })
    await waitFor(() => expect(container.querySelector('.hakka-json-key .hakka-json-mark')).not.toBeNull())

    fireEvent.input(input, { target: { value: 'ansuman' } })
    await waitFor(() => expect(container.querySelector('.hakka-json-string .hakka-json-mark')).not.toBeNull())
  })

  it('auto-expands a depth-2+ collapsed branch that contains a match', async () => {
    const deep = JSON.stringify({ a: { b: { c: 'needle-in-a-haystack' } } })
    const { container } = render(() => <JsonViewer text={deep} />)
    // Collapsed by default at depth 2 — the target string isn't in the DOM yet.
    expect(container.querySelector('.hakka-json-ellipsis')).not.toBeNull()
    expect(container.textContent).not.toContain('needle-in-a-haystack')

    const input = container.querySelector('.hakka-json-search') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'needle' } })

    await waitFor(() => expect(container.textContent).toContain('needle-in-a-haystack'))
  })

  it('debounces roughly 150ms behind typing — no filter effect on the immediate keystroke', () => {
    const { container } = render(() => <JsonViewer text='{"greeting":"hello world"}' />)
    const input = container.querySelector('.hakka-json-search') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'zzz_nomatch' } })
    // Synchronously (before the debounce timer fires) the tint must still be neutral.
    expect(input.classList.contains('no-match')).toBe(false)
    expect(input.classList.contains('match')).toBe(false)
  })

  it('resets the search when the underlying body text changes', async () => {
    const [text, setText] = createSignal('{"greeting":"hello world"}')
    const { container } = render(() => <JsonViewer text={text()} />)
    const input = container.querySelector('.hakka-json-search') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'hello' } })
    await waitFor(() => expect(input.classList.contains('match')).toBe(true))

    setText('{"other":"payload"}')
    await waitFor(() => {
      const freshInput = container.querySelector('.hakka-json-search') as HTMLInputElement
      expect(freshInput.value).toBe('')
      expect(freshInput.classList.contains('match')).toBe(false)
    })
  })
})
