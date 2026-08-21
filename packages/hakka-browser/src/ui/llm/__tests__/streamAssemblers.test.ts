import { decodeSse } from 'hakka-core'
import { describe, expect, it } from 'vitest'

import { assembleAnthropicStream } from '../anthropicStreamAssembler'
import { assembleOpenAiStream } from '../openAiStreamAssembler'
import { readSseFixture } from './sseFixtures'

describe('assembleOpenAiStream — pinned fixture transcript', () => {
  const assembled = assembleOpenAiStream(decodeSse(readSseFixture('openai-chat-chunks.sse')))

  it('joins content deltas into the final text', () => {
    expect(assembled.text).toBe('The capital of France is Paris.')
  })

  it('reassembles delta.tool_calls fragments — id and name from the first fragment, arguments concatenated', () => {
    expect(assembled.toolCalls).toEqual([
      { id: 'call_wx001', name: 'get_weather', arguments: '{"city":"Paris","unit":"celsius"}' },
    ])
  })

  it('carries the terminal finish reason, model, and honest event count (data: [DONE] included)', () => {
    expect(assembled.finishReason).toBe('tool_calls')
    expect(assembled.model).toBe('gpt-4o-2024-08-06')
    expect(assembled.eventCount).toBe(9)
  })
})

describe('assembleOpenAiStream — accumulation by index', () => {
  it('keeps two interleaved tool calls separate and in index order', () => {
    const body = [
      'data: {"model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"second","arguments":"[2"}}]}}]}',
      '',
      'data: {"model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"first","arguments":"[1"}}]}}]}',
      '',
      'data: {"model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":", 4]"}}]}}]}',
      '',
      'data: {"model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":", 3]"}}]}}]}',
      '',
    ].join('\n')
    const assembled = assembleOpenAiStream(decodeSse(body))
    expect(assembled.toolCalls).toEqual([
      { id: 'call_a', name: 'first', arguments: '[1, 3]' },
      { id: 'call_b', name: 'second', arguments: '[2, 4]' },
    ])
  })

  it('tolerates a stream cut mid-arguments — the fragment is shown, never thrown on', () => {
    const full = readSseFixture('openai-chat-chunks.sse')
    // Whole records up through the FIRST arguments fragment only — the rest of
    // the stream (second fragment, finish chunk, usage, [DONE]) never arrives.
    const cut = full.split('\n\n').slice(0, 5).join('\n\n')
    const assembled = assembleOpenAiStream(decodeSse(cut))
    expect(assembled.text).toBe('The capital of France is Paris.')
    expect(assembled.toolCalls).toEqual([{ id: 'call_wx001', name: 'get_weather', arguments: '{"ci' }])
    expect(assembled.finishReason).toBeUndefined() // the terminal chunk never arrived
  })
})

describe('assembleAnthropicStream — pinned fixture transcript', () => {
  const assembled = assembleAnthropicStream(decodeSse(readSseFixture('anthropic-messages.sse')))

  it('joins text_delta events into the final text', () => {
    expect(assembled.text).toBe('The capital of France is Paris.')
  })

  it('reassembles a tool_use block from its input_json_delta fragments', () => {
    expect(assembled.toolCalls).toEqual([
      { id: 'toolu_hakka001', name: 'get_weather', arguments: '{"city":"Paris","unit":"celsius"}' },
    ])
  })

  it('carries message_start model, message_delta stop reason, and the full event count (pings included)', () => {
    expect(assembled.model).toBe('claude-sonnet-4-5-20250929')
    expect(assembled.finishReason).toBe('tool_use')
    expect(assembled.eventCount).toBe(12)
  })
})

describe('stream assemblers — plain (non-LLM) event streams', () => {
  it('assemble to empty content with an honest event count, rather than throwing', () => {
    const events = decodeSse(readSseFixture('plain-events.sse'))
    for (const assembled of [assembleOpenAiStream(events), assembleAnthropicStream(events)]) {
      expect(assembled.text).toBe('')
      expect(assembled.toolCalls).toEqual([])
      expect(assembled.finishReason).toBeUndefined()
      expect(assembled.model).toBeUndefined()
      expect(assembled.eventCount).toBe(4)
    }
  })
})
