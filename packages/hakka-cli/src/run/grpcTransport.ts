import { connect } from 'node:http2'

import { decodeBase64, maximumBytes, sessionSignal } from './transportLimits.js'
import type { TransportOutput } from './transports.js'

function decodeMessage(value: string): Buffer {
  const compact = value.replace(/\s/g, '')
  const bytes = /^(?:[0-9a-f]{2})*$/i.test(compact) ? Buffer.from(compact, 'hex') : decodeBase64(compact)
  if (bytes.length > maximumBytes) throw new Error('gRPC message exceeds 5 MiB limit')
  return bytes
}

function unaryMessage(frame: Buffer): Buffer {
  if (frame.length < 5 || frame[0] !== 0) throw new Error('Invalid or compressed gRPC response frame')
  const length = frame.readUInt32BE(1)
  if (length !== frame.length - 5) throw new Error('Expected exactly one complete gRPC response message')
  return frame.subarray(5)
}

/** Raw unary protobuf over HTTP/2; transport failures and missing trailers cannot pass as success. */
export async function executeGrpc(
  url: URL,
  headers: Headers,
  encoded: string,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<TransportOutput> {
  if (!['grpc:', 'grpcs:'].includes(url.protocol) || !/^\/[^/]+\/[^/]+$/.test(url.pathname))
    throw new Error('gRPC URL must contain /service/method')
  const signal = sessionSignal(timeoutMs, parentSignal)
  signal.throwIfAborted()
  const message = decodeMessage(encoded)
  const prefix = Buffer.alloc(5)
  prefix.writeUInt32BE(message.length, 1)
  const requestHeaders: Record<string, string> = {
    ':method': 'POST',
    ':path': url.pathname,
    'content-type': 'application/grpc',
    te: 'trailers',
    'grpc-timeout': `${Math.min(timeoutMs, 99_999_999)}m`,
  }
  const reserved = new Set([
    'content-type',
    'content-length',
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'te',
    'grpc-timeout',
  ])
  for (const [name, value] of headers) if (!name.startsWith(':') && !reserved.has(name)) requestHeaders[name] = value
  return await new Promise((resolve, reject) => {
    const client = connect(`${url.protocol === 'grpcs:' ? 'https:' : 'http:'}//${url.host}`)
    let settled = false
    const finish = (error?: Error, result?: TransportOutput) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      client.destroy()
      if (error) reject(error)
      else resolve(result!)
    }
    const abort = () => finish(new Error('gRPC request cancelled or timed out'))
    signal.addEventListener('abort', abort, { once: true })
    client.on('error', finish)
    let request: ReturnType<typeof client.request>
    try {
      request = client.request(requestHeaders)
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Could not create gRPC request'))
      return
    }
    let size = 0
    let httpStatus: number | undefined
    const chunks: Buffer[] = []
    const responseHeaders = new Headers()
    const appendHeaders = (value: Record<string, unknown>) => {
      for (const [name, entry] of Object.entries(value))
        if (!name.startsWith(':') && entry !== undefined)
          responseHeaders.set(name, Array.isArray(entry) ? entry.join(', ') : String(entry))
    }
    request.on('response', (value) => {
      httpStatus = value[':status']
      appendHeaders(value)
    })
    request.on('trailers', appendHeaders)
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maximumBytes + 5) finish(new Error('gRPC response exceeds 5 MiB limit'))
      else chunks.push(chunk)
    })
    request.on('error', finish)
    request.on('aborted', () => finish(new Error('gRPC stream aborted')))
    request.on('end', () => {
      if (settled) return
      try {
        if (httpStatus !== 200) throw new Error(`gRPC HTTP transport returned ${httpStatus ?? 'no status'}`)
        const status = responseHeaders.get('grpc-status')
        if (status === null || !/^(?:[0-9]|1[0-6])$/.test(status)) throw new Error('Missing or invalid grpc-status')
        const frame = Buffer.concat(chunks)
        const bytes = frame.length ? unaryMessage(frame) : Buffer.alloc(0)
        if (status === '0' && !frame.length) throw new Error('Successful unary gRPC response has no message')
        finish(undefined, {
          status: status === '0' ? 200 : 500,
          headers: responseHeaders,
          body: JSON.stringify({
            messageBase64: bytes.toString('base64'),
            grpcStatus: status,
            grpcMessage: responseHeaders.get('grpc-message'),
          }),
        })
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Invalid gRPC response'))
      }
    })
    request.on('close', () => {
      if (!request.readableEnded) finish(new Error('gRPC stream closed before completion'))
    })
    request.end(Buffer.concat([prefix, message]))
    if (signal.aborted) abort()
  })
}
