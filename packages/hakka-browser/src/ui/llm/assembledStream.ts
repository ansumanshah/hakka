/**
 * Shapes shared by the provider stream assemblers (`openAiStreamAssembler`,
 * `anthropicStreamAssembler`) — what a `text/event-stream` body adds up to
 * once its deltas are joined. Presenter-side only: nothing here feeds back
 * into the record contract.
 */

/** One tool call reassembled from its delta fragments, in call order. */
export interface AssembledToolCall {
  /** Provider-assigned call id, when the wire carries one. */
  id?: string
  /** Function/tool name. */
  name?: string
  /** Concatenated raw arguments JSON — complete when the stream finished, a fragment mid-stream. */
  arguments: string
}

/** The assembled result of an LLM event stream. */
export interface AssembledStream {
  /** Every parsed SSE event, whatever its kind — data events, pings, named no-data events. */
  eventCount: number
  /** Assistant text: all text deltas/blocks joined in arrival order. */
  text: string
  /** Tool calls in call order. */
  toolCalls: AssembledToolCall[]
  /** Finish/stop reason verbatim from the wire (`stop`, `tool_calls`, `tool_use`, ...). */
  finishReason?: string
  /** Model name as reported on the wire. */
  model?: string
}
