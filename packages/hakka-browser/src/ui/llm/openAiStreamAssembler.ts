/**
 * Assembles an OpenAI-family `chat.completion.chunk` stream (the wire shape
 * also used by the OpenAI-compatible gateways) into its final message:
 * content deltas join into `text`, `delta.tool_calls` fragments accumulate
 * by their `index` into whole tool calls, and the terminal chunk's
 * `finish_reason`/`model` are carried through. Non-JSON events (keep-alives,
 * provider control lines) are skipped, never thrown on.
 */
import type { SseEvent } from 'hakka-core'

import type { AssembledStream, AssembledToolCall } from './assembledStream'

interface ToolCallAccumulator extends AssembledToolCall {
  /** The stream's own tool-call index — fragments for the same call share it. */
  slot: number
}

interface StreamChoice {
  delta?: { content?: unknown; tool_calls?: unknown }
  finish_reason?: unknown
}

interface StreamChunk {
  model?: unknown
  choices?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Join `events` (already parsed SSE records) into the assembled OpenAI message. */
export function assembleOpenAiStream(events: SseEvent[]): AssembledStream {
  let text = ''
  let finishReason: string | undefined
  let model: string | undefined
  const slots = new Map<number, ToolCallAccumulator>()

  for (const event of events) {
    if (event.data === '[DONE]') continue
    let chunk: StreamChunk
    try {
      const parsed: unknown = JSON.parse(event.data)
      if (!isRecord(parsed)) continue
      chunk = parsed as StreamChunk
    } catch {
      continue
    }

    if (model === undefined) model = asString(chunk.model)
    if (!Array.isArray(chunk.choices)) continue

    for (const rawChoice of chunk.choices) {
      if (!isRecord(rawChoice)) continue
      const choice = rawChoice as unknown as StreamChoice
      if (isRecord(choice.delta)) {
        if (typeof choice.delta.content === 'string') text += choice.delta.content
        if (Array.isArray(choice.delta.tool_calls)) {
          for (const rawCall of choice.delta.tool_calls) {
            if (!isRecord(rawCall)) continue
            const slot = typeof rawCall.index === 'number' ? rawCall.index : 0
            let call = slots.get(slot)
            if (!call) {
              call = { slot, arguments: '' }
              slots.set(slot, call)
            }
            const fn = isRecord(rawCall.function) ? rawCall.function : undefined
            const id = asString(rawCall.id)
            const name = asString(fn?.name)
            if (id !== undefined) call.id = id
            if (name !== undefined) call.name = name
            if (fn !== undefined && typeof fn.arguments === 'string') call.arguments += fn.arguments
          }
        }
      }
      const reason = asString(choice.finish_reason)
      if (reason !== undefined) finishReason = reason
    }
  }

  const toolCalls: AssembledToolCall[] = [...slots.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((call) => {
      const publicCall: AssembledToolCall = { arguments: call.arguments }
      if (call.id !== undefined) publicCall.id = call.id
      if (call.name !== undefined) publicCall.name = call.name
      return publicCall
    })

  return {
    eventCount: events.length,
    text,
    toolCalls,
    finishReason,
    model,
  }
}
