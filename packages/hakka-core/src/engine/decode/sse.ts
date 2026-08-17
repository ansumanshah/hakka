import type { BodyDecoder } from './bodyDecoderRegistry'

/** A single parsed Server-Sent Event record. */
export interface SseEvent {
  /** The `event:` field value, if present (defaults to "message" per spec, but left undefined here when absent). */
  event?: string
  /** The `data:` field value(s), joined with '\n' per the EventSource spec. */
  data: string
  /** The `id:` field value, if present. */
  id?: string
  /** The `retry:` field value (reconnection time in ms), if present and numeric. */
  retry?: number
}

/**
 * Parse a raw text/event-stream body into a list of SSE events, per the
 * WHATWG EventSource framing: records are split on blank lines, each holding
 * `field: value` lines (`event`/`data`/`id`/`retry`); multiple `data:` lines
 * join with '\n'; ':'-prefixed lines are comments. A record with no `data`
 * is normally dropped, but one with only `event`/`id`/`retry` still emits
 * with `data: ''` so it stays visible in the inspector. CRLF/LF/CR line
 * endings all accepted. Never throws — malformed input degrades gracefully.
 */
export function decodeSse(body: string): SseEvent[] {
  const events: SseEvent[] = []
  if (!body) return events

  const normalized = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')

  let curEvent: string | undefined
  let curData: string[] = []
  let curId: string | undefined
  let curRetry: number | undefined
  let sawAnyField = false

  const flush = (): void => {
    if (sawAnyField) {
      const rec: SseEvent = { data: curData.join('\n') }
      if (curEvent !== undefined) rec.event = curEvent
      if (curId !== undefined) rec.id = curId
      if (curRetry !== undefined) rec.retry = curRetry
      events.push(rec)
    }
    curEvent = undefined
    curData = []
    curId = undefined
    curRetry = undefined
    sawAnyField = false
  }

  for (const rawLine of lines) {
    if (rawLine === '') {
      // Blank line = dispatch boundary
      flush()
      continue
    }
    if (rawLine.startsWith(':')) {
      // Comment line — ignored
      continue
    }

    const colonIdx = rawLine.indexOf(':')
    let field: string
    let value: string
    if (colonIdx === -1) {
      // Line with no colon: the whole line is the field name, value is ""
      field = rawLine
      value = ''
    } else {
      field = rawLine.slice(0, colonIdx)
      value = rawLine.slice(colonIdx + 1)
      // A single leading space in the value is stripped per spec
      if (value.startsWith(' ')) value = value.slice(1)
    }

    switch (field) {
      case 'event':
        curEvent = value
        sawAnyField = true
        break
      case 'data':
        curData.push(value)
        sawAnyField = true
        break
      case 'id':
        // Spec says a NUL-containing id should be ignored; skipped here since
        // bodies are JS strings without embedded NULs in practice.
        curId = value
        sawAnyField = true
        break
      case 'retry': {
        if (/^\d+$/.test(value)) {
          curRetry = Number(value)
          sawAnyField = true
        }
        break
      }
      default:
        // Unknown field — ignored per spec
        break
    }
  }

  // Flush any trailing record that wasn't terminated by a final blank line
  flush()

  return events
}

const SSE_CONTENT_TYPE = 'text/event-stream'

export const sseDecoder: BodyDecoder = {
  id: 'sse',

  decode(body, contentType): string | null {
    if (!contentType) return null
    const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
    if (ct !== SSE_CONTENT_TYPE) return null

    const events = decodeSse(body)
    return JSON.stringify(events, null, 2)
  },
}
