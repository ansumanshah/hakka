import { afterEach, describe, expect, test } from 'bun:test'

import type { WsFrameDecoder, WsFrameInfo } from '../wsDecoders'

// Each describe block imports a fresh module instance via a unique query param
// (same pattern as decoders.test.ts) so registry state doesn't leak between suites.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < bytes.length ? B64[b2 & 63] : '='
  }
  return out
}

/** Build a minimal MQTT PINGREQ packet: 0xC0 0x00 */
function buildPingreq(): Uint8Array {
  return new Uint8Array([0xc0, 0x00])
}

/**
 * Build an MQTT PUBLISH packet.
 * Fixed header byte0 = (3 << 4) | (qos << 1)
 * Variable header: 2-byte topic length + topic bytes + optional 2-byte packetId
 * Payload: payload bytes
 */
function buildPublish(topic: string, qos: number, packetId: number | null, payload: string): Uint8Array {
  const topicBytes = new TextEncoder().encode(topic)
  const payloadBytes = new TextEncoder().encode(payload)

  const varHeader: number[] = [(topicBytes.length >> 8) & 0xff, topicBytes.length & 0xff, ...topicBytes]
  if (qos > 0 && packetId !== null) {
    varHeader.push((packetId >> 8) & 0xff, packetId & 0xff)
  }

  const remainingLength = varHeader.length + payloadBytes.length
  // Encode remaining length as MQTT varint (single byte for < 128)
  const rl: number[] = []
  let rlVal = remainingLength
  do {
    let digit = rlVal % 128
    rlVal = Math.floor(rlVal / 128)
    if (rlVal > 0) digit |= 0x80
    rl.push(digit)
  } while (rlVal > 0)

  const byte0 = (3 << 4) | ((qos & 0x03) << 1)
  return new Uint8Array([byte0, ...rl, ...varHeader, ...payloadBytes])
}

/** Build a minimal MQTT CONNECT packet: type=1, remaining=0 (not a valid full CONNECT but enough for type detection). */
function buildConnect(): Uint8Array {
  return new Uint8Array([0x10, 0x00])
}

describe('MQTT decoder — PINGREQ', () => {
  test('decodes 0xC0 0x00 as PINGREQ', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=pingreq')
    const data = bytesToBase64(buildPingreq())
    const result = wsFrameDecoders.decode({ data, binary: true }, 'mqtt')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('mqtt')
    expect(result!.summary).toBe('PINGREQ')
  })

  test('returns null for a text frame (not binary)', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=pingreq-text')
    const result = wsFrameDecoders.decode({ data: 'hello world', binary: false }, 'mqtt')
    expect(result).toBeNull()
  })
})

describe('MQTT decoder — PUBLISH QoS 1', () => {
  test('decodes topic, qos, packetId, and payloadPreview', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=publish-qos1')
    const bytes = buildPublish('a/b', 1, 42, 'hello')
    const data = bytesToBase64(bytes)
    const result = wsFrameDecoders.decode({ data, binary: true }, 'mqtt')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('mqtt')
    expect(result!.topic).toBe('a/b')
    expect(result!.qos).toBe(1)
    expect(result!.packetId).toBe(42)
    expect(result!.payloadPreview).toBe('hello')
    expect(result!.summary).toContain('PUBLISH')
    expect(result!.summary).toContain('topic=a/b')
    expect(result!.summary).toContain('qos=1')
    expect(result!.summary).toContain('packetId=42')
  })

  test('decodes QoS 0 (no packetId)', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=publish-qos0')
    const bytes = buildPublish('sensors/temp', 0, null, '22.5')
    const data = bytesToBase64(bytes)
    const result = wsFrameDecoders.decode({ data, binary: true }, 'mqtt')
    expect(result).not.toBeNull()
    expect(result!.topic).toBe('sensors/temp')
    expect(result!.qos).toBe(0)
    expect(result!.packetId).toBeUndefined()
    expect(result!.payloadPreview).toBe('22.5')
  })

  test('truncates long payload to ~120 chars', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=publish-truncate')
    const longPayload = 'x'.repeat(200)
    const bytes = buildPublish('t', 0, null, longPayload)
    const data = bytesToBase64(bytes)
    const result = wsFrameDecoders.decode({ data, binary: true }, 'mqtt')
    expect(result).not.toBeNull()
    expect(result!.payloadPreview).toBeDefined()
    expect(result!.payloadPreview!.length).toBeLessThanOrEqual(125) // 120 + ellipsis char
    expect(result!.payloadPreview!.endsWith('…')).toBe(true)
  })
})

describe('MQTT decoder — CONNECT type', () => {
  test('decodes packet type 1 as CONNECT', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=connect')
    const data = bytesToBase64(buildConnect())
    const result = wsFrameDecoders.decode({ data, binary: true }, 'mqtt')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('mqtt')
    expect(result!.summary).toBe('CONNECT')
  })
})

describe('MQTT decoder — non-MQTT frame returns null', () => {
  test('random binary that does not parse as MQTT returns null or a safe result', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=non-mqtt')
    // Packet type 0 (reserved) — not a valid MQTT type
    const badBytes = new Uint8Array([0x00, 0x00])
    const data = bytesToBase64(badBytes)
    const result = wsFrameDecoders.decode({ data, binary: true }, 'mqtt')
    expect(result).toBeNull()
  })

  test('text frame with non-mqtt protocol returns null', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=text-non-mqtt')
    const result = wsFrameDecoders.decode({ data: '{"type":"ping"}', binary: false }, 'mqtt')
    expect(result).toBeNull()
  })
})

describe('wsFrameDecoders registry — custom decoder wins for its protocol', () => {
  test('custom decoder registered for a specific protocol is called', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=registry-custom')

    const myDecoder: WsFrameDecoder = {
      id: 'my-proto',
      protocols: ['my-proto'],
      decode(_frame, _protocol): WsFrameInfo {
        return { kind: 'my-proto', summary: 'custom-match' }
      },
    }
    wsFrameDecoders.register(myDecoder)

    const result = wsFrameDecoders.decode({ data: 'anything', binary: false }, 'my-proto')
    expect(result).not.toBeNull()
    expect(result!.summary).toBe('custom-match')
  })

  test('custom decoder is NOT called for a different protocol', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=registry-miss')

    const myDecoder: WsFrameDecoder = {
      id: 'my-proto-2',
      protocols: ['my-proto-2'],
      decode(): WsFrameInfo {
        return { kind: 'my-proto-2', summary: 'should-not-appear' }
      },
    }
    wsFrameDecoders.register(myDecoder)

    // MQTT PINGREQ frame but with a different protocol — mqtt decoder should handle it
    const data = bytesToBase64(buildPingreq())
    const result = wsFrameDecoders.decode({ data, binary: true }, 'mqtt')
    // The my-proto-2 decoder should be skipped; mqtt decoder should still run
    expect(result?.summary).not.toBe('should-not-appear')
    expect(result?.summary).toBe('PINGREQ')
  })

  test('universal decoder (no protocols field) is called regardless of protocol', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=registry-universal')

    // Unregister the built-in mqtt decoder so only our universal one runs
    wsFrameDecoders.unregister('mqtt')

    const universal: WsFrameDecoder = {
      id: 'universal',
      // no protocols — matches everything
      decode(): WsFrameInfo {
        return { kind: 'universal', summary: 'caught-all' }
      },
    }
    wsFrameDecoders.register(universal)

    const result = wsFrameDecoders.decode({ data: 'anything', binary: false }, 'some-unknown-protocol')
    expect(result).not.toBeNull()
    expect(result!.summary).toBe('caught-all')
  })

  test('unregister removes a decoder', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=registry-unregister')

    const dec: WsFrameDecoder = {
      id: 'temp',
      decode(): WsFrameInfo {
        return { kind: 'temp', summary: 'temp' }
      },
    }
    wsFrameDecoders.register(dec)
    expect(wsFrameDecoders.decode({ data: 'x', binary: false }, '')).not.toBeNull()

    wsFrameDecoders.unregister('temp')
    // mqtt decoder is still registered but returns null for text frames
    const after = wsFrameDecoders.decode({ data: 'x', binary: false }, '')
    expect(after).toBeNull()
  })

  test('list() returns snapshot of registered decoders', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=registry-list')
    const list = wsFrameDecoders.list()
    // Built-in mqtt decoder is always registered
    expect(list.some((d) => d.id === 'mqtt')).toBe(true)
  })
})

describe('Socket.IO decoder — EVENT frame', () => {
  test('decodes a Socket.IO EVENT frame with event name and arg count', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=sio-event')
    // "42" prefix: EIO type 4 (message) + SIO type 2 (EVENT)
    const frame = { data: '42["chat",{"msg":"hello"}]', binary: false }
    const result = wsFrameDecoders.decode(frame, '')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('socket.io')
    expect(result!.summary).toContain('EVENT')
    expect(result!.summary).toContain('chat')
    expect(result!.summary).toContain('1 arg')
  })

  test('decodes a Socket.IO ping frame (EIO type 2)', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=sio-ping')
    const frame = { data: '2probe', binary: false }
    const result = wsFrameDecoders.decode(frame, '')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('socket.io')
    expect(result!.summary).toBe('ping')
  })

  test('decodes a Socket.IO EVENT with multiple args', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=sio-multi-args')
    // ["join","room1","room2"] → event name "join" + 2 args (room1, room2)
    const frame = { data: '42["join","room1","room2"]', binary: false }
    const result = wsFrameDecoders.decode(frame, '')
    expect(result).not.toBeNull()
    expect(result!.summary).toContain('2 args')
  })

  test('returns null for a plain text frame that is not Socket.IO', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=sio-plain-text')
    // Unregister stomp and graphql-ws decoders so only socket.io and mqtt remain
    wsFrameDecoders.unregister('stomp')
    wsFrameDecoders.unregister('graphql-ws')
    const frame = { data: 'hello world', binary: false }
    const result = wsFrameDecoders.decode(frame, '')
    expect(result).toBeNull()
  })
})

describe('STOMP decoder — SEND frame', () => {
  test('decodes a STOMP SEND frame with destination and body', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=stomp-send')
    const stompFrame = 'SEND\ndestination:/queue/orders\ncontent-type:application/json\n\n{"order":1}\0'
    const frame = { data: stompFrame, binary: false }
    const result = wsFrameDecoders.decode(frame, 'v12.stomp')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('stomp')
    expect(result!.summary).toBe('SEND /queue/orders')
    expect(result!.topic).toBe('/queue/orders')
    expect(result!.payloadPreview).toBe('{"order":1}')
  })

  test('decodes a STOMP MESSAGE frame', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=stomp-message')
    const stompFrame = 'MESSAGE\ndestination:/topic/news\nsubscription:sub-0\n\nbreaking news\0'
    const frame = { data: stompFrame, binary: false }
    const result = wsFrameDecoders.decode(frame, 'v11.stomp')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('stomp')
    expect(result!.summary).toContain('MESSAGE')
    expect(result!.topic).toBe('/topic/news')
  })

  test('returns null for an unrecognised STOMP command', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=stomp-unknown-cmd')
    const frame = { data: 'WHATEVER\n\n\0', binary: false }
    const result = wsFrameDecoders.decode(frame, 'v12.stomp')
    expect(result).toBeNull()
  })

  test('returns null for a plain text frame on stomp protocol', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=stomp-plain')
    const frame = { data: 'hello world', binary: false }
    const result = wsFrameDecoders.decode(frame, 'v12.stomp')
    expect(result).toBeNull()
  })
})

describe('graphql-ws decoder — next frame', () => {
  test('decodes a graphql-ws next frame with id and payload preview', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=gql-next')
    const msg = JSON.stringify({ type: 'next', id: '1', payload: { data: { user: { name: 'Alice' } } } })
    const frame = { data: msg, binary: false }
    const result = wsFrameDecoders.decode(frame, 'graphql-transport-ws')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('graphql-ws')
    expect(result!.summary).toBe('next #1')
    expect(result!.payloadPreview).toBeDefined()
  })

  test('decodes a graphql-ws subscribe frame', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=gql-subscribe')
    const msg = JSON.stringify({ type: 'subscribe', id: '2', payload: { query: '{ users { id } }' } })
    const frame = { data: msg, binary: false }
    const result = wsFrameDecoders.decode(frame, 'graphql-transport-ws')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('graphql-ws')
    expect(result!.summary).toBe('subscribe #2')
  })

  test('decodes a graphql-ws connection_init (no id)', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=gql-init')
    const msg = JSON.stringify({ type: 'connection_init' })
    const frame = { data: msg, binary: false }
    const result = wsFrameDecoders.decode(frame, 'graphql-transport-ws')
    expect(result).not.toBeNull()
    expect(result!.summary).toBe('connection_init')
  })

  test('returns null for JSON that is not a graphql-ws message', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=gql-non-gql')
    const msg = JSON.stringify({ type: 'unknown_type_xyz', id: '3' })
    const frame = { data: msg, binary: false }
    const result = wsFrameDecoders.decode(frame, 'graphql-transport-ws')
    expect(result).toBeNull()
  })

  test('returns null for a plain text frame on graphql-ws protocol', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=gql-plain')
    const frame = { data: 'hello world', binary: false }
    const result = wsFrameDecoders.decode(frame, 'graphql-transport-ws')
    expect(result).toBeNull()
  })
})

describe('plain text frame — null from all new decoders', () => {
  test('a plain text frame returns null when no protocol matches and content is unrecognised', async () => {
    const { wsFrameDecoders } = await import('../wsDecoders?v=plain-all-null')
    // Remove mqtt (binary only); plain text "hello" should not match socket.io, stomp, or graphql-ws
    wsFrameDecoders.unregister('mqtt')
    wsFrameDecoders.unregister('stomp')
    wsFrameDecoders.unregister('graphql-ws')
    // socket.io decoder is universal — also disable it
    wsFrameDecoders.unregister('socket.io')
    const frame = { data: 'hello world', binary: false }
    const result = wsFrameDecoders.decode(frame, '')
    expect(result).toBeNull()
  })
})

describe('websocket interceptor — wsProtocol field', () => {
  afterEach(() => {
    // Restore any patched WebSocket
    ;(globalThis as Record<string, unknown>).WebSocket = undefined
  })

  test('wsProtocol is empty string before open event', async () => {
    const { enableWebSocketInterceptor } = await import('../../capture/websocket?v=proto-before-open')
    const records: import('../../model/types').NetworkRequest[] = []

    type EventHandler = (event: unknown) => void

    class FakeWS {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      readonly protocol = 'mqtt'
      private listeners: Map<string, EventHandler[]> = new Map()
      dispatchFakeEvent(type: string, ev: unknown) {
        for (const h of this.listeners.get(type) ?? []) h(ev)
      }
      addEventListener(type: string, h: EventHandler) {
        const l = this.listeners.get(type) ?? []
        l.push(h)
        this.listeners.set(type, l)
      }
      send() {}
      bind() {
        return this.send.bind(this)
      }
    }

    let fakeWs: FakeWS | null = null
    ;(globalThis as Record<string, unknown>).WebSocket = class extends FakeWS {
      constructor(_url: string) {
        super()
        // oxlint-disable-next-line typescript/no-this-alias
        fakeWs = this
      }
    }
    const Ctor = (globalThis as Record<string, unknown>).WebSocket as typeof FakeWS
    Object.defineProperty(Ctor, 'CONNECTING', { value: 0, configurable: true })
    Object.defineProperty(Ctor, 'OPEN', { value: 1, configurable: true })
    Object.defineProperty(Ctor, 'CLOSING', { value: 2, configurable: true })
    Object.defineProperty(Ctor, 'CLOSED', { value: 3, configurable: true })

    const dispose = enableWebSocketInterceptor((r) => records.push(r))
    new (globalThis.WebSocket as unknown as new (url: string) => unknown)('wss://broker.test/ws')

    // Fire open — interceptor reads this.protocol
    fakeWs!.dispatchFakeEvent('open', {})
    expect(records).toHaveLength(1)
    expect(records[0].wsProtocol).toBe('mqtt')

    dispose()
  })
})
