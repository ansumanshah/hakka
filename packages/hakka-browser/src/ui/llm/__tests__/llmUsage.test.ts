import { describe, expect, it } from 'vitest'

import { parseLlmUsage } from '../llmUsage'
import { readSseFixture } from './sseFixtures'

describe('parseLlmUsage — streaming bodies (pinned fixtures)', () => {
  it('reads the FINAL usage chunk from an OpenAI stream — the chunk tail-side capture exists to preserve', () => {
    const usage = parseLlmUsage(readSseFixture('openai-chat-chunks.sse'), 'openai')
    expect(usage).toEqual({
      promptTokens: 25,
      completionTokens: 48,
      totalTokens: 73,
      model: 'gpt-4o-2024-08-06',
    })
  })

  it('combines Anthropic message_start input tokens with message_delta output tokens, deriving the total', () => {
    const usage = parseLlmUsage(readSseFixture('anthropic-messages.sse'), 'anthropic')
    expect(usage).toEqual({
      promptTokens: 25,
      completionTokens: 48,
      totalTokens: 73, // not on the Anthropic wire — prompt + completion
      model: 'claude-sonnet-4-5-20250929',
    })
  })

  it('returns null for a plain (non-LLM) event stream', () => {
    expect(parseLlmUsage(readSseFixture('plain-events.sse'))).toBeNull()
  })

  it('sniffs the wire family without a provider hint (OpenAI-compatible proxies on unknown hosts)', () => {
    expect(parseLlmUsage(readSseFixture('openai-chat-chunks.sse'))).toMatchObject({ totalTokens: 73 })
    expect(parseLlmUsage(readSseFixture('anthropic-messages.sse'))).toMatchObject({ promptTokens: 25 })
  })
})

describe('parseLlmUsage — non-streaming JSON bodies', () => {
  it('parses the OpenAI response shape', () => {
    const usage = parseLlmUsage(
      '{"id":"chatcmpl-1","model":"gpt-4o-2024-08-06","usage":{"prompt_tokens":9,"completion_tokens":12,"total_tokens":21}}',
      'openai',
    )
    expect(usage).toEqual({ promptTokens: 9, completionTokens: 12, totalTokens: 21, model: 'gpt-4o-2024-08-06' })
  })

  it('parses the Anthropic response shape (input/output naming)', () => {
    const usage = parseLlmUsage(
      '{"id":"msg_1","model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":9,"output_tokens":12}}',
      'anthropic',
    )
    expect(usage).toEqual({
      promptTokens: 9,
      completionTokens: 12,
      totalTokens: 21,
      model: 'claude-sonnet-4-5-20250929',
    })
  })

  it('parses the Gemini response shape (usageMetadata + modelVersion)', () => {
    const usage = parseLlmUsage(
      '{"candidates":[{"content":{"parts":[{"text":"hi"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":12,"totalTokenCount":21},"modelVersion":"gemini-2.0-flash"}',
      'gemini',
    )
    expect(usage).toEqual({
      promptTokens: 9,
      completionTokens: 12,
      totalTokens: 21,
      model: 'gemini-2.0-flash',
    })
  })

  it('parses a Gemini stream whose final chunk carries the completed usageMetadata', () => {
    const body = [
      'data: {"candidates":[{"content":{"parts":[{"text":"he"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":2,"totalTokenCount":11},"modelVersion":"gemini-2.0-flash"}',
      '',
      'data: {"candidates":[],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":12,"totalTokenCount":21},"modelVersion":"gemini-2.0-flash"}',
      '',
    ].join('\n')
    expect(parseLlmUsage(body, 'gemini')).toEqual({
      promptTokens: 9,
      completionTokens: 12, // last-wins: counts grow chunk over chunk
      totalTokens: 21,
      model: 'gemini-2.0-flash',
    })
  })
})

describe('parseLlmUsage — tolerance', () => {
  it('returns null on bodies with no usage and no model, without throwing', () => {
    expect(parseLlmUsage('{"ok":true}')).toBeNull()
    expect(parseLlmUsage('not json at all')).toBeNull()
    expect(parseLlmUsage('')).toBeNull()
    expect(parseLlmUsage(null)).toBeNull()
  })

  it('reports model-only while a stream is still mid-flight (no usage chunk yet)', () => {
    const body = 'data: {"model":"gpt-4o-2024-08-06","choices":[{"delta":{"content":"par"}}]}\n\n'
    expect(parseLlmUsage(body, 'openai')).toEqual({ model: 'gpt-4o-2024-08-06' })
  })
})
