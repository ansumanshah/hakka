import { boundedInteger, maximumBytes, maximumMessages, sessionSignal } from './transportLimits.js'
import type { SessionSpec, TransportOutput } from './transports.js'

interface Event {
  event: string
  data: string
  id?: string
}

/** Handles CR, LF and CRLF across chunks, multiline data, comments, and persistent event IDs. */
export async function executeSse(
  url: URL,
  headers: Headers,
  spec: NonNullable<SessionSpec['sse']>,
  parentSignal?: AbortSignal,
): Promise<TransportOutput> {
  const signal = sessionSignal(spec.timeoutMs, parentSignal)
  signal.throwIfAborted()
  const maxEvents = boundedInteger(spec.maxEvents, 'SSE maxEvents', maximumMessages)
  const response = await fetch(url, { headers, signal })
  if (
    !response.ok ||
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/event-stream'
  ) {
    await response.body?.cancel()
    throw new Error(`Expected an SSE response, received HTTP ${response.status}`)
  }
  if (!response.body) throw new Error('SSE response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events: Event[] = []
  let bytes = 0
  let line = ''
  let skipLF = false
  let data: string[] = []
  let event = ''
  let id: string | undefined
  const consumeLine = () => {
    if (!line) {
      if (data.length)
        events.push({ event: event || 'message', data: data.join('\n'), ...(id !== undefined ? { id } : {}) })
      data = []
      event = ''
    } else if (!line.startsWith(':')) {
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'data') data.push(value)
      else if (field === 'event') event = value
      else if (field === 'id' && !value.includes('\0')) id = value
    }
    line = ''
  }
  try {
    while (events.length < maxEvents) {
      const next = await reader.read()
      if (next.done) throw new Error('SSE stream ended before maxEvents')
      bytes += next.value.byteLength
      if (bytes > maximumBytes) throw new Error('SSE stream exceeds 5 MiB limit')
      for (const character of decoder.decode(next.value, { stream: true })) {
        if (skipLF && character === '\n') {
          skipLF = false
          continue
        }
        skipLF = character === '\r'
        if (character === '\r' || character === '\n') consumeLine()
        else line += character
        if (events.length === maxEvents) break
      }
    }
    return { status: response.status, headers: response.headers, body: JSON.stringify({ events }) }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
