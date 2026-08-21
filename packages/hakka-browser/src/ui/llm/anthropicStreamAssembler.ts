/**
 * Assembles an Anthropic Messages API event stream into its final message:
 * `content_block_delta` text deltas join into `text`, a `tool_use` block's
 * `input_json_delta` fragments concatenate into its input JSON (blocks are
 * indexed, so interleaved blocks stay separate), `message_start` carries the
 * model, and `message_delta` the stop reason. Unrelated events (`ping`,
 * unknown types) are skipped, never thrown on.
 */
import type { SseEvent } from 'hakka-core'

import type { AssembledStream, AssembledToolCall } from './assembledStream'

interface ToolBlockAccumulator extends AssembledToolCall {
  /** The stream's own content-block index — fragments for the same block share it. */
  slot: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Join `events` (already parsed SSE records) into the assembled Anthropic message. */
export function assembleAnthropicStream(events: SseEvent[]): AssembledStream {
  let text = ''
  let finishReason: string | undefined
  let model: string | undefined
  const blocks = new Map<number, ToolBlockAccumulator>()

  for (const event of events) {
    let payload: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(event.data)
      if (!isRecord(parsed)) continue
      payload = parsed
    } catch {
      continue
    }

    switch (payload.type) {
      case 'message_start': {
        const message = isRecord(payload.message) ? payload.message : undefined
        if (model === undefined && typeof message?.model === 'string') model = message.model
        break
      }
      case 'content_block_start': {
        const block = isRecord(payload.content_block) ? payload.content_block : undefined
        if (block?.type !== 'tool_use') break
        const slot = typeof payload.index === 'number' ? payload.index : blocks.size
        blocks.set(slot, {
          slot,
          id: typeof block.id === 'string' ? block.id : undefined,
          name: typeof block.name === 'string' ? block.name : undefined,
          arguments: '',
        })
        break
      }
      case 'content_block_delta': {
        const delta = isRecord(payload.delta) ? payload.delta : undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          text += delta.text
        } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const slot = typeof payload.index === 'number' ? payload.index : -1
          const block = blocks.get(slot)
          if (block) block.arguments += delta.partial_json
        }
        break
      }
      case 'message_delta': {
        const delta = isRecord(payload.delta) ? payload.delta : undefined
        if (typeof delta?.stop_reason === 'string') finishReason = delta.stop_reason
        break
      }
      default:
        break
    }
  }

  const toolCalls: AssembledToolCall[] = [...blocks.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((block) => {
      const publicCall: AssembledToolCall = { arguments: block.arguments }
      if (block.id !== undefined) publicCall.id = block.id
      if (block.name !== undefined) publicCall.name = block.name
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
