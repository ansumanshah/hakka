/**
 * SSE tab — renders a `text/event-stream` response as an assembled LLM
 * message (deltas joined, tool calls reassembled) above the raw event list,
 * with counts. Assembly is provider-aware: OpenAI-family chunks and
 * Anthropic events join into a final message; Gemini/unknown streams have no
 * delta grammar to join and show the raw events alone. Loads as its own
 * lazy chunk via `LazyDetailSseTab`.
 */
import type { NetworkRequest } from 'hakka-core'
import { decodeSse } from 'hakka-core'
import type { Component } from 'solid-js'
import { createMemo, For, Loading, Show } from 'solid-js'

import { assembleAnthropicStream } from './llm/anthropicStreamAssembler'
import type { AssembledStream } from './llm/assembledStream'
import { detectLlmProvider } from './llm/llmProvider'
import { assembleOpenAiStream } from './llm/openAiStreamAssembler'

/** DOM-bounding display cap — a long token stream can carry thousands of events; the count still shows the true total. */
const MAX_RENDERED_EVENTS = 100

/** OpenAI's chunk grammar is shared by every OpenAI-compatible gateway. */
const OPENAI_FAMILY = new Set(['openai', 'azure-openai', 'openrouter', 'groq', 'mistral'])

interface DetailSseTabProps {
  req: NetworkRequest
  /** Raw response-body accessor backed by the store's getBody round-trip (see Detail.tsx's bodyAsync). */
  body: () => string | null | undefined
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    // Mid-stream the arguments are still a fragment — show it verbatim.
    return text
  }
}

export const DetailSseTab: Component<DetailSseTabProps> = (props) => {
  const provider = createMemo(() => detectLlmProvider(props.req.url))
  // Read through the async body memo inside the <Loading> below — same
  // stale-content contract as the body region, scoped to this tab.
  const events = createMemo(() => decodeSse(props.body() ?? ''))
  const assembled = createMemo((): AssembledStream | null => {
    const id = provider()?.id
    if (id === 'anthropic') return assembleAnthropicStream(events())
    if (id !== undefined && OPENAI_FAMILY.has(id)) return assembleOpenAiStream(events())
    return null
  })
  const shownEvents = createMemo(() => events().slice(0, MAX_RENDERED_EVENTS))
  const hiddenCount = createMemo(() => events().length - shownEvents().length)

  return (
    <Loading fallback={<p class="hakka-empty-hint">Loading events…</p>}>
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: 'var(--hakka-space-sm)',
          'flex-wrap': 'wrap',
          'margin-bottom': 'var(--hakka-space-md)',
        }}
      >
        <span
          style={{
            'font-size': 'var(--hakka-font-xs)',
            'font-weight': '600',
            'letter-spacing': '0.04em',
            'text-transform': 'uppercase',
            color: 'var(--hakka-text-tertiary)',
          }}
        >
          {events().length} events
        </span>
        <Show when={assembled()?.model}>
          <span style={{ 'font-size': 'var(--hakka-font-sm)', 'font-family': 'var(--hakka-font-mono)' }}>
            {assembled()!.model}
          </span>
        </Show>
        <Show when={assembled()?.finishReason}>
          <span class="hakka-rt-tag" style={{ 'font-size': 'var(--hakka-font-xs)' }}>
            {assembled()!.finishReason}
          </span>
        </Show>
      </div>

      <Show when={assembled()}>
        <p class="hakka-section-title">Assembled message</p>
        <Show when={assembled()!.text} fallback={<p class="hakka-empty-hint">No text content in this stream</p>}>
          <pre class="hakka-initiator" style={{ 'white-space': 'pre-wrap' }}>
            {assembled()!.text}
          </pre>
        </Show>
        <Show when={assembled()!.toolCalls.length > 0}>
          <p class="hakka-section-title">Tool calls ({assembled()!.toolCalls.length})</p>
          <For each={assembled()!.toolCalls}>
            {(call) => (
              <div style={{ 'margin-bottom': 'var(--hakka-space-sm)' }}>
                <span
                  style={{
                    'font-size': 'var(--hakka-font-sm)',
                    'font-weight': '600',
                    'font-family': 'var(--hakka-font-mono)',
                    color: 'var(--hakka-text)',
                  }}
                >
                  {call.name ?? call.id ?? '(unnamed call)'}
                </span>
                <pre class="hakka-initiator" style={{ 'white-space': 'pre-wrap' }}>
                  {prettyJson(call.arguments)}
                </pre>
              </div>
            )}
          </For>
        </Show>
      </Show>

      <p class="hakka-section-title">Raw events ({events().length})</p>
      <For each={shownEvents()}>
        {(event, i) => (
          <div style={{ 'margin-bottom': 'var(--hakka-space-xs)' }}>
            <span
              style={{
                'font-size': 'var(--hakka-font-xs)',
                'font-family': 'var(--hakka-font-mono)',
                color: 'var(--hakka-text-tertiary)',
                'margin-right': 'var(--hakka-space-sm)',
              }}
            >
              #{i() + 1}
              {event.event ? ` ${event.event}` : ''}
            </span>
            <pre class="hakka-initiator hakka-sse-event-data">{event.data}</pre>
          </div>
        )}
      </For>
      <Show when={hiddenCount() > 0}>
        <p class="hakka-empty-hint">… {hiddenCount()} more events not shown</p>
      </Show>
    </Loading>
  )
}
