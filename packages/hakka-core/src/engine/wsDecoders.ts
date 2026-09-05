/**
 * WsFrameDecoder — extensible WS frame decoding pipeline, mirroring
 * BodyDecoder/bodyDecoders. Decoders whose `protocols` list includes the
 * negotiated sub-protocol run first; decoders with no `protocols` list are
 * universal fallbacks. The first non-null WsFrameInfo result wins.
 */

/** Rich annotation a decoder can attach to a single WS frame. */
export interface WsFrameInfo {
  /** Decoder family, e.g. 'mqtt'. */
  kind: string
  /** Short human-readable description, e.g. 'PUBLISH topic=foo/bar qos=1'. */
  summary: string
  /** Topic string (MQTT PUBLISH / SUBSCRIBE). */
  topic?: string
  /** MQTT QoS level (0, 1, or 2). */
  qos?: number
  /** MQTT packet identifier (present when QoS > 0). */
  packetId?: number
  /** UTF-8 payload preview, truncated to ~120 chars. */
  payloadPreview?: string
}

/** A decoder that can annotate a single WS frame. */
export interface WsFrameDecoder {
  /** Unique identifier, e.g. 'mqtt'. */
  id: string
  /**
   * Sub-protocols this decoder handles, e.g. ['mqtt', 'mqttv5.0'].
   * When omitted the decoder is offered every frame regardless of protocol.
   */
  protocols?: string[]
  /**
   * Attempt to decode the frame.
   * @param frame    The raw WS frame ({data, binary}) as captured by Hakka.
   * @param protocol The negotiated sub-protocol string ('' if none).
   * @returns WsFrameInfo when the frame is recognised, or null to defer.
   */
  decode(frame: { data: string | number; binary: boolean }, protocol?: string): WsFrameInfo | null
}

class WsFrameDecoderRegistry {
  private readonly decoders: WsFrameDecoder[] = []

  /**
   * Register a decoder. Earlier registrations have higher priority.
   * Registering with a duplicate id replaces the existing entry.
   */
  register(decoder: WsFrameDecoder): void {
    const idx = this.decoders.findIndex((d) => d.id === decoder.id)
    if (idx !== -1) {
      this.decoders[idx] = decoder
    } else {
      this.decoders.push(decoder)
    }
  }

  /** Remove a decoder by id. No-op if not found. */
  unregister(id: string): void {
    const idx = this.decoders.findIndex((d) => d.id === id)
    if (idx !== -1) this.decoders.splice(idx, 1)
  }

  /** Snapshot of currently registered decoders (stable copy). */
  list(): WsFrameDecoder[] {
    return [...this.decoders]
  }

  /**
   * Run the decoder pipeline.
   * Only decoders whose `protocols` list includes `protocol` (or whose
   * `protocols` is undefined) are eligible. Returns the first non-null result,
   * or null when no decoder recognises the frame.
   */
  decode(frame: { data: string | number; binary: boolean }, protocol?: string): WsFrameInfo | null {
    for (const decoder of this.decoders) {
      if (decoder.protocols !== undefined && protocol && !decoder.protocols.includes(protocol)) continue
      try {
        const result = decoder.decode(frame, protocol)
        if (result !== null) return result
      } catch {
        // Never let a buggy decoder break the pipeline
      }
    }
    return null
  }
}

/** Convenience wrapper — calls the singleton registry. */
export function decodeWsFrame(
  frame: { data: string | number; binary: boolean },
  protocol?: string,
): WsFrameInfo | null {
  return wsFrameDecoders.decode(frame, protocol)
}

// Base64 → Uint8Array, no atob/Buffer dependency (platform-neutral).
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Built once at module load (128 bytes); 0xff marks invalid chars.
const B64_LOOKUP = /* @__PURE__ */ ((): Uint8Array => {
  const tbl = new Uint8Array(128).fill(0xff)
  for (let i = 0; i < B64_CHARS.length; i++) tbl[B64_CHARS.charCodeAt(i)] = i
  return tbl
})()

function base64ToBytes(b64: string): Uint8Array | null {
  const clean = b64.replace(/=+$/, '')
  const len = clean.length
  if (len === 0) return new Uint8Array(0)

  const lookup = B64_LOOKUP

  // Validate every character before allocating output
  for (let i = 0; i < len; i++) {
    const c = clean.charCodeAt(i)
    if (c > 127 || lookup[c] === 0xff) return null
  }

  const byteLen = Math.floor((len * 3) / 4)
  const out = new Uint8Array(byteLen)
  let outIdx = 0

  for (let i = 0; i < len; i += 4) {
    const a = lookup[clean.charCodeAt(i)] ?? 0
    const b = lookup[clean.charCodeAt(i + 1)] ?? 0
    const c2 = i + 2 < len ? (lookup[clean.charCodeAt(i + 2)] ?? 0) : 0
    const d = i + 3 < len ? (lookup[clean.charCodeAt(i + 3)] ?? 0) : 0
    const triple = (a << 18) | (b << 12) | (c2 << 6) | d
    if (outIdx < byteLen) out[outIdx++] = (triple >> 16) & 0xff
    if (outIdx < byteLen) out[outIdx++] = (triple >> 8) & 0xff
    if (outIdx < byteLen) out[outIdx++] = triple & 0xff
  }

  return out
}

// UTF-8 decode without TextDecoder — pure TS for platform-neutral use.
function utf8Decode(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  let i = start
  while (i < end) {
    const b0 = bytes[i++]
    if (b0 === undefined) break
    if (b0 < 0x80) {
      out += String.fromCharCode(b0)
    } else if ((b0 & 0xe0) === 0xc0) {
      const b1 = bytes[i++] ?? 0
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f))
    } else if ((b0 & 0xf0) === 0xe0) {
      const b1 = bytes[i++] ?? 0
      const b2 = bytes[i++] ?? 0
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f))
    } else if ((b0 & 0xf8) === 0xf0) {
      const b1 = bytes[i++] ?? 0
      const b2 = bytes[i++] ?? 0
      const b3 = bytes[i++] ?? 0
      const codePoint = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)
      // Encode as surrogate pair for codepoints > U+FFFF
      const cp = codePoint - 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    } else {
      out += '�'
    }
  }
  return out
}

const MQTT_PACKET_TYPES: Record<number, string> = {
  1: 'CONNECT',
  2: 'CONNACK',
  3: 'PUBLISH',
  4: 'PUBACK',
  5: 'PUBREC',
  6: 'PUBREL',
  7: 'PUBCOMP',
  8: 'SUBSCRIBE',
  9: 'SUBACK',
  10: 'UNSUBSCRIBE',
  11: 'UNSUBACK',
  12: 'PINGREQ',
  13: 'PINGRESP',
  14: 'DISCONNECT',
  15: 'AUTH',
}

/** Parse the MQTT remaining-length varint. Returns [value, bytesConsumed] or null on overflow. */
function parseRemainingLength(bytes: Uint8Array, offset: number): [number, number] | null {
  let value = 0
  let multiplier = 1
  let consumed = 0
  for (let i = 0; i < 4; i++) {
    const pos = offset + i
    if (pos >= bytes.length) return null
    const byte = bytes[pos]!
    value += (byte & 0x7f) * multiplier
    consumed++
    if ((byte & 0x80) === 0) return [value, consumed]
    multiplier *= 128
  }
  return null // malformed: more than 4 bytes
}

const mqttDecoder: WsFrameDecoder = {
  id: 'mqtt',
  protocols: ['mqtt', 'mqttv3.1', 'mqttv3.1.1', 'mqttv5.0'],

  decode(frame) {
    if (!frame.binary || typeof frame.data !== 'string') return null

    const bytes = base64ToBytes(frame.data)
    if (!bytes || bytes.length < 2) return null

    const byte0 = bytes[0]!
    const packetType = (byte0 >> 4) & 0x0f
    const flags = byte0 & 0x0f

    const typeName = MQTT_PACKET_TYPES[packetType]
    if (!typeName) return null

    const rl = parseRemainingLength(bytes, 1)
    if (!rl) return null
    const [remainingLength, rlBytes] = rl
    const varHeaderStart = 1 + rlBytes
    const packetEnd = varHeaderStart + remainingLength

    // Bounds sanity check — allow truncated captures but reject obviously bad headers
    if (varHeaderStart > bytes.length) return null

    // PUBLISH
    if (packetType === 3) {
      const qos = (flags >> 1) & 0x03

      // Parse topic: 2-byte big-endian length prefix + UTF-8 string
      if (varHeaderStart + 2 > bytes.length) return { kind: 'mqtt', summary: 'PUBLISH' }
      const topicLen = ((bytes[varHeaderStart]! << 8) | bytes[varHeaderStart + 1]!) >>> 0
      const topicStart = varHeaderStart + 2
      const topicEnd = topicStart + topicLen

      if (topicEnd > bytes.length) return { kind: 'mqtt', summary: 'PUBLISH' }
      const topic = utf8Decode(bytes, topicStart, topicEnd)

      let cursor = topicEnd
      let packetId: number | undefined

      if (qos > 0) {
        if (cursor + 2 > bytes.length) return { kind: 'mqtt', summary: `PUBLISH topic=${topic} qos=${qos}`, topic, qos }
        packetId = ((bytes[cursor]! << 8) | bytes[cursor + 1]!) >>> 0
        cursor += 2
      }

      const payloadEnd = Math.min(packetEnd, bytes.length)
      let payloadPreview: string | undefined
      if (cursor < payloadEnd) {
        const raw = utf8Decode(bytes, cursor, payloadEnd)
        payloadPreview = raw.length > 120 ? raw.slice(0, 120) + '…' : raw
      }

      const parts = [`PUBLISH topic=${topic} qos=${qos}`]
      if (packetId !== undefined) parts.push(`packetId=${packetId}`)
      return { kind: 'mqtt', summary: parts.join(' '), topic, qos, packetId, payloadPreview }
    }

    return { kind: 'mqtt', summary: typeName }
  },
}

const EIO_TYPE_NAMES: Record<number, string> = {
  0: 'open',
  1: 'close',
  2: 'ping',
  3: 'pong',
  4: 'message',
  5: 'upgrade',
  6: 'noop',
}

const SIO_TYPE_NAMES: Record<number, string> = {
  0: 'CONNECT',
  1: 'DISCONNECT',
  2: 'EVENT',
  3: 'ACK',
  4: 'CONNECT_ERROR',
  5: 'BINARY_EVENT',
  6: 'BINARY_ACK',
}

const socketioDecoder: WsFrameDecoder = {
  id: 'socket.io',
  // No protocols — detect by content
  protocols: undefined,

  decode(frame): WsFrameInfo | null {
    if (frame.binary) return null
    const text = typeof frame.data === 'string' ? frame.data : String(frame.data)
    if (text.length === 0) return null

    try {
      // Engine.IO type digit (0–6) must be the first character
      const eioTypeChar = text.charCodeAt(0) - 48
      if (eioTypeChar < 0 || eioTypeChar > 6) return null
      const eioTypeName = EIO_TYPE_NAMES[eioTypeChar]
      if (!eioTypeName) return null

      // Non-message Engine.IO packets (ping/pong/open/close/…) — reject anything
      // implausibly long for a bare control packet.
      if (eioTypeChar !== 4) {
        if (text.length > 200) return null
        return { kind: 'socket.io', summary: eioTypeName }
      }

      // Engine.IO type 4 = Socket.IO packet — next digit is Socket.IO type
      if (text.length < 2) return null
      const sioTypeChar = text.charCodeAt(1) - 48
      if (sioTypeChar < 0 || sioTypeChar > 6) return null
      const sioTypeName = SIO_TYPE_NAMES[sioTypeChar]
      if (!sioTypeName) return null

      // Parse optional namespace (starts with '/' after the type digit)
      let cursor = 2
      let namespace = '/'
      if (cursor < text.length && text[cursor] === '/') {
        const commaIdx = text.indexOf(',', cursor)
        if (commaIdx !== -1) {
          namespace = text.slice(cursor, commaIdx)
          cursor = commaIdx + 1
        }
      }

      // Skip optional ack id (digits)
      while (cursor < text.length && text.charCodeAt(cursor) >= 48 && text.charCodeAt(cursor) <= 57) {
        cursor++
      }

      // For EVENT and ACK, the rest is a JSON array
      if (sioTypeChar === 2 || sioTypeChar === 3) {
        const rest = text.slice(cursor)
        if (!rest.startsWith('[')) return null
        const parsed: unknown = JSON.parse(rest)
        if (!Array.isArray(parsed)) return null
        const eventName = parsed[0]
        const argCount = parsed.length - 1
        const nameLabel = typeof eventName === 'string' ? eventName : ''
        const ns = namespace !== '/' ? ` (${namespace})` : ''
        const summary =
          sioTypeChar === 2
            ? `EVENT ${nameLabel}${ns} (${argCount} arg${argCount !== 1 ? 's' : ''})`
            : `ACK ${nameLabel}${ns} (${argCount} arg${argCount !== 1 ? 's' : ''})`
        return { kind: 'socket.io', summary }
      }

      // CONNECT / DISCONNECT / CONNECT_ERROR
      const packetLabel = `${text.slice(0, 2)} ${sioTypeName}`
      return { kind: 'socket.io', summary: packetLabel }
    } catch {
      return null
    }
  },
}

const STOMP_COMMANDS = new Set([
  'CONNECT',
  'STOMP',
  'CONNECTED',
  'SEND',
  'SUBSCRIBE',
  'UNSUBSCRIBE',
  'ACK',
  'NACK',
  'BEGIN',
  'COMMIT',
  'ABORT',
  'DISCONNECT',
  'RECEIPT',
  'ERROR',
  'MESSAGE',
])

const stompDecoder: WsFrameDecoder = {
  id: 'stomp',
  protocols: ['v10.stomp', 'v11.stomp', 'v12.stomp'],

  decode(frame): WsFrameInfo | null {
    if (frame.binary) return null
    const text = typeof frame.data === 'string' ? frame.data : String(frame.data)
    if (text.length === 0) return null

    try {
      const newlineIdx = text.indexOf('\n')
      const commandLine = newlineIdx === -1 ? text : text.slice(0, newlineIdx)
      // Strip optional CR for CRLF line endings
      const command = commandLine.endsWith('\r') ? commandLine.slice(0, -1) : commandLine

      if (!STOMP_COMMANDS.has(command)) return null

      // Parse headers: lines until blank line
      const headers: Record<string, string> = {}
      let cursor = newlineIdx + 1
      while (cursor < text.length) {
        const lineEnd = text.indexOf('\n', cursor)
        const line = lineEnd === -1 ? text.slice(cursor) : text.slice(cursor, lineEnd)
        const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
        if (trimmed.length === 0) {
          cursor = (lineEnd === -1 ? text.length : lineEnd) + 1
          break
        }
        const colonIdx = trimmed.indexOf(':')
        if (colonIdx !== -1) {
          const key = trimmed.slice(0, colonIdx).trim()
          const value = trimmed.slice(colonIdx + 1).trim()
          headers[key] = value
        }
        cursor = lineEnd === -1 ? text.length : lineEnd + 1
      }

      const destination = headers['destination']

      // Body: everything from cursor up to the NULL terminator
      const nullIdx = text.indexOf('\0', cursor)
      const bodyEnd = nullIdx === -1 ? text.length : nullIdx
      const body = text.slice(cursor, bodyEnd)
      const payloadPreview = body.length > 120 ? body.slice(0, 120) + '…' : body.length > 0 ? body : undefined

      const summaryParts = [command]
      if (destination) summaryParts.push(destination)

      return {
        kind: 'stomp',
        summary: summaryParts.join(' '),
        topic: destination,
        payloadPreview,
      }
    } catch {
      return null
    }
  },
}

const GQL_WS_TYPES = new Set([
  'connection_init',
  'connection_ack',
  'connection_error',
  'ping',
  'pong',
  'subscribe',
  'next',
  'error',
  'complete',
  // legacy graphql-ws protocol types
  'start',
  'stop',
  'connection_terminate',
  'ka',
  'data',
])

const graphqlWsDecoder: WsFrameDecoder = {
  id: 'graphql-ws',
  protocols: ['graphql-transport-ws', 'graphql-ws'],

  decode(frame): WsFrameInfo | null {
    if (frame.binary) return null
    const text = typeof frame.data === 'string' ? frame.data : String(frame.data)
    if (text.length === 0 || text[0] !== '{') return null

    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null

      const msg = parsed as Record<string, unknown>
      const msgType = msg['type']
      if (typeof msgType !== 'string') return null
      if (!GQL_WS_TYPES.has(msgType)) return null

      const id = msg['id']
      const payload = msg['payload']

      const idLabel = id !== undefined && id !== null ? ` #${String(id)}` : ''

      let payloadPreview: string | undefined
      if (payload !== undefined && payload !== null) {
        const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
        payloadPreview = raw.length > 120 ? raw.slice(0, 120) + '…' : raw
      }

      const summary = `${msgType}${idLabel}`

      return { kind: 'graphql-ws', summary, payloadPreview }
    } catch {
      return null
    }
  },
}

/** Singleton with protocol-specific decoders before the universal fallback. */
export const wsFrameDecoders = /* @__PURE__ */ (() => {
  const registry = new WsFrameDecoderRegistry()
  registry.register(mqttDecoder)
  registry.register(graphqlWsDecoder)
  registry.register(stompDecoder)
  registry.register(socketioDecoder)
  return registry
})()
