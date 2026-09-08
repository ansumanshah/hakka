import WebSocket from 'ws'

import { boundedInteger, decodeBase64, maximumBytes, maximumMessages, sessionSignal } from './transportLimits.js'
import type { SessionSpec, TransportOutput } from './transports.js'

/** A finite capture closes on its requested frame count, deadline, cancellation, or byte limit. */
export async function executeWebSocket(
  url: URL,
  headers: Headers,
  spec: NonNullable<SessionSpec['webSocket']>,
  parentSignal?: AbortSignal,
): Promise<TransportOutput> {
  const signal = sessionSignal(spec.timeoutMs, parentSignal)
  signal.throwIfAborted()
  const maxFrames = boundedInteger(spec.maxFrames, 'WebSocket maxFrames', maximumMessages)
  if (!Array.isArray(spec.sendFrames) || spec.sendFrames.length > maximumMessages)
    throw new Error('WebSocket sendFrames exceeds its limit')
  let sentBytes = 0
  const outgoing = spec.sendFrames.map((frame) => {
    if (typeof frame.data !== 'string' || typeof frame.isBinary !== 'boolean')
      throw new Error('Invalid WebSocket frame')
    const data = frame.isBinary ? decodeBase64(frame.data) : Buffer.from(frame.data)
    sentBytes += data.length
    if (sentBytes > maximumBytes) throw new Error('Outgoing WebSocket frames exceed 5 MiB limit')
    return { data, binary: frame.isBinary }
  })
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: Object.fromEntries(headers.entries()), maxPayload: maximumBytes })
    const frames: Array<{ data: string; isBinary: boolean }> = []
    let receivedBytes = 0
    let settled = false
    const responseHeaders = new Headers()
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      socket.terminate()
      if (error) reject(error)
      else resolve({ status: 101, headers: responseHeaders, body: JSON.stringify({ frames }) })
    }
    const abort = () => finish(new Error('WebSocket session cancelled or timed out before maxFrames'))
    signal.addEventListener('abort', abort, { once: true })
    socket.on('upgrade', (response) => {
      for (const [name, value] of Object.entries(response.headers))
        if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value)
    })
    socket.on('open', () => {
      if (signal.aborted) {
        abort()
        return
      }
      for (const frame of outgoing) socket.send(frame.data, { binary: frame.binary })
    })
    socket.on('message', (raw, isBinary) => {
      if (settled) return
      const data = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer)
      receivedBytes += data.length
      if (receivedBytes > maximumBytes) {
        finish(new Error('WebSocket frames exceed 5 MiB limit'))
        return
      }
      frames.push({ data: isBinary ? data.toString('base64') : data.toString('utf8'), isBinary })
      if (frames.length === maxFrames) finish()
    })
    socket.on('error', finish)
    socket.on('close', () => finish(new Error('WebSocket closed before maxFrames')))
    if (signal.aborted) abort()
  })
}
