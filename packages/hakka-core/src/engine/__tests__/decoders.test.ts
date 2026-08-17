import { describe, expect, test } from 'bun:test'

import { BodyDecoderRegistry, deflateDecoder, gzipDecoder, protobufDetector } from '../decode/bodyDecoderRegistry'
import { grpcWebDecoder } from '../decode/grpcWeb'
import { protobufWireDecoder } from '../decode/protobuf'
import { sseDecoder } from '../decode/sse'
import type { BodyDecoder } from '../decoders'

/**
 * A fresh `BodyDecoderRegistry` mirroring `engine/decoders.ts`'s registration
 * order, isolated from the shared `bodyDecoders` singleton so tests can
 * register test-only decoders without leaking state. Re-importing
 * `decoders.ts` would NOT isolate tests — the `bodyDecoders` module it
 * imports stays cached/shared by its stable specifier regardless; only
 * building a fresh instance directly does.
 */
function freshBodyDecoders(): BodyDecoderRegistry {
  const registry = new BodyDecoderRegistry()
  registry.register(gzipDecoder)
  registry.register(deflateDecoder)
  registry.register(sseDecoder)
  registry.register(grpcWebDecoder)
  registry.register(protobufWireDecoder)
  registry.register(protobufDetector)
  return registry
}

describe('bodyDecoders registry — passthrough default', () => {
  test('returns body unchanged when no decoders are registered', () => {
    const fresh = freshBodyDecoders()
    expect(fresh.decode('raw body', undefined)).toBe('raw body')
  })

  test('returns body unchanged for unknown content types', () => {
    const fresh = freshBodyDecoders()
    expect(fresh.decode('{"a":1}', 'application/octet-stream')).toBe('{"a":1}')
  })
})

describe('bodyDecoders registry — register and decode', () => {
  test('first non-null result wins', () => {
    const reg = freshBodyDecoders()

    const upper: BodyDecoder = { id: 'upper', decode: (body) => body.toUpperCase() }
    const lower: BodyDecoder = { id: 'lower', decode: (body) => body.toLowerCase() }
    reg.register(upper)
    reg.register(lower)

    expect(reg.decode('Hello', undefined)).toBe('HELLO')
  })

  test('decoder returning null defers to next decoder', () => {
    const reg = freshBodyDecoders()

    const skip: BodyDecoder = {
      id: 'skip',
      decode(_body, contentType) {
        return contentType === 'text/plain' ? null : 'MATCHED'
      },
    }
    const fallback: BodyDecoder = {
      id: 'fallback',
      decode: (body) => `fallback:${body}`,
    }
    reg.register(skip)
    reg.register(fallback)

    expect(reg.decode('hello', 'text/plain')).toBe('fallback:hello')
    expect(reg.decode('hello', 'application/json')).toBe('MATCHED')
  })

  test('registering a decoder with duplicate id replaces the existing one', () => {
    const reg = freshBodyDecoders()

    const v1: BodyDecoder = { id: 'my-decoder', decode: () => 'v1' }
    const v2: BodyDecoder = { id: 'my-decoder', decode: () => 'v2' }

    reg.register(v1)
    expect(reg.decode('x', undefined)).toBe('v1')

    reg.register(v2)
    expect(reg.decode('x', undefined)).toBe('v2')
  })

  test('all decoders returning null falls back to passthrough', () => {
    const reg = freshBodyDecoders()

    const noop: BodyDecoder = { id: 'noop', decode: () => null }
    reg.register(noop)

    expect(reg.decode('unchanged', 'application/json')).toBe('unchanged')
  })
})

import { gzipSync, strToU8, zlibSync } from 'fflate'

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

function gzipBase64(text: string): string {
  return toBase64(gzipSync(strToU8(text)))
}

/**
 * HTTP Content-Encoding: deflate in practice sends zlib-wrapped deflate (RFC 2616).
 * zlibSync produces the 0x78-prefixed zlib format that servers emit.
 */
function deflateBase64(text: string): string {
  return toBase64(zlibSync(strToU8(text)))
}

describe('built-in gzip decoder — round-trip', () => {
  test('decompresses a gzip-compressed base64 body', () => {
    const bodyDecoders = freshBodyDecoders()
    const original = '{"hello":"world","n":42}'
    const compressed = gzipBase64(original)

    const result = bodyDecoders.decode(compressed, 'application/json', 'gzip')
    expect(result).toBe(original)
  })

  test('decompresses with content-encoding x-gzip', () => {
    const bodyDecoders = freshBodyDecoders()
    const original = 'plain text body'
    const compressed = gzipBase64(original)

    const result = bodyDecoders.decode(compressed, 'text/plain', 'x-gzip')
    expect(result).toBe(original)
  })

  test('no-op when content-encoding is absent', () => {
    const bodyDecoders = freshBodyDecoders()
    const original = '{"hello":"world"}'
    const compressed = gzipBase64(original)

    // Without Content-Encoding: gzip, should pass through unchanged
    const result = bodyDecoders.decode(compressed, 'application/json', undefined)
    expect(result).toBe(compressed)
  })

  test('no-op on plain (non-gzip) body even when encoding says gzip', () => {
    const bodyDecoders = freshBodyDecoders()
    const plain = '{"already":"decoded"}'

    // Content-Encoding: gzip but the body is not actually gzip — guard must catch this
    const result = bodyDecoders.decode(plain, 'application/json', 'gzip')
    // Falls through to passthrough (not gzip magic bytes)
    expect(result).toBe(plain)
  })

  test('graceful fallback on corrupt compressed data', () => {
    const bodyDecoders = freshBodyDecoders()
    // Valid gzip magic prefix in base64 but rest is garbage
    // 0x1f 0x8b = H4s…, pad to look like gzip but then garbage
    const corrupt = 'H4sIAAAAAAAA/corrupt+data+here=='

    const result = bodyDecoders.decode(corrupt, 'application/json', 'gzip')
    // Decompression fails → falls back to passthrough → returns the original string
    expect(result).toBe(corrupt)
  })

  test('decompresses larger payload correctly', () => {
    const bodyDecoders = freshBodyDecoders()
    const original = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` })) })
    const compressed = gzipBase64(original)

    const result = bodyDecoders.decode(compressed, 'application/json', 'gzip')
    expect(result).toBe(original)
  })
})

describe('built-in deflate decoder — round-trip', () => {
  test('decompresses a deflate-compressed base64 body', () => {
    const bodyDecoders = freshBodyDecoders()
    const original = '{"hello":"world","n":42}'
    const compressed = deflateBase64(original)

    const result = bodyDecoders.decode(compressed, 'application/json', 'deflate')
    expect(result).toBe(original)
  })

  test('no-op when content-encoding is absent', () => {
    const bodyDecoders = freshBodyDecoders()
    const original = 'hello world'
    const compressed = deflateBase64(original)

    const result = bodyDecoders.decode(compressed, 'text/plain', undefined)
    expect(result).toBe(compressed)
  })

  test('no-op on plain (non-compressed) body even when encoding says deflate', () => {
    const bodyDecoders = freshBodyDecoders()
    // Plain JSON that is not zlib-compressed — graceful fallback when decompression fails
    const plain = '{"already":"decoded","value":42}'

    // Content-Encoding: deflate but the body is already decoded plain text.
    // decompressSync throws → graceful return null → passthrough returns original.
    const result = bodyDecoders.decode(plain, 'application/json', 'deflate')
    expect(result).toBe(plain)
  })

  test('graceful fallback on corrupt compressed data', () => {
    const bodyDecoders = freshBodyDecoders()
    // 0x78 0x9c = valid zlib CMF+FLG prefix in base64: "eJw…"
    const corrupt = 'eJwcorrupt+data+here=='

    const result = bodyDecoders.decode(corrupt, 'application/json', 'deflate')
    expect(result).toBe(corrupt)
  })
})

describe('built-in protobuf detector', () => {
  // A minimal protobuf: field 1, wire type 2 (length-delimited), value "hi"
  // Tag: (1 << 3) | 2 = 0x0a, length: 0x02, payload: 0x68 0x69
  const PROTO_BYTES = new Uint8Array([0x0a, 0x02, 0x68, 0x69])
  const PROTO_B64 = toBase64(PROTO_BYTES)

  // application/x-protobuf and application/protobuf route to the 'protobuf-wire'
  // decoder (see the "protobuf-wire decoder" suite below). This hex/base64
  // fingerprint preview covers only unary gRPC content types (application/grpc,
  // application/grpc+proto) — not gRPC-web framed, so grpc-web can't unwrap them.
  test('detects application/grpc', () => {
    const bodyDecoders = freshBodyDecoders()
    const result = bodyDecoders.decode(PROTO_B64, 'application/grpc')
    expect(result).toContain('[protobuf')
  })

  test('detects application/grpc+proto', () => {
    const bodyDecoders = freshBodyDecoders()
    const result = bodyDecoders.decode(PROTO_B64, 'application/grpc+proto')
    expect(result).toContain('[protobuf')
  })

  test('no-op on non-protobuf content types', () => {
    const bodyDecoders = freshBodyDecoders()
    const result = bodyDecoders.decode(PROTO_B64, 'application/json')
    // Falls through to passthrough — returns the original string unchanged
    expect(result).toBe(PROTO_B64)
  })

  test('no-op when content-type is undefined', () => {
    const bodyDecoders = freshBodyDecoders()
    const result = bodyDecoders.decode(PROTO_B64, undefined)
    expect(result).toBe(PROTO_B64)
  })
})

describe('bodyDecoders registry — application/x-protobuf now fully decoded', () => {
  // Same fixture as above, but this content type is claimed by the
  // 'protobuf-wire' decoder — a real wire-format decode, not a hex preview.
  const PROTO_BYTES = new Uint8Array([0x0a, 0x02, 0x68, 0x69])
  const PROTO_B64 = toBase64(PROTO_BYTES)

  test('decodes application/x-protobuf into a readable field tree, not a hex preview', () => {
    const bodyDecoders = freshBodyDecoders()
    const result = bodyDecoders.decode(PROTO_B64, 'application/x-protobuf')
    expect(result).toContain('1 (string): "hi"')
    expect(result).not.toContain('[protobuf')
  })

  test('decodes application/protobuf the same way', () => {
    const bodyDecoders = freshBodyDecoders()
    const result = bodyDecoders.decode(PROTO_B64, 'application/protobuf')
    expect(result).toContain('1 (string): "hi"')
  })

  test('strips content-type parameters before matching', () => {
    const bodyDecoders = freshBodyDecoders()
    const result = bodyDecoders.decode(PROTO_B64, 'application/x-protobuf; charset=binary')
    expect(result).toContain('1 (string): "hi"')
  })
})

describe('built-in decoders — no-op on plain bodies', () => {
  test('encoding header with unrelated value does not trigger gzip decoder', () => {
    const bodyDecoders = freshBodyDecoders()
    const plain = 'brotli-decompressed text'
    // Platform already decompressed br; content-encoding may be absent or something else
    const result = bodyDecoders.decode(plain, 'text/plain', 'br')
    expect(result).toBe(plain)
  })
})

describe('registry.decode() — contentEncoding forwarding', () => {
  test('passes contentEncoding to each registered decoder', () => {
    const reg = freshBodyDecoders()

    const seen: Array<string | undefined> = []
    const spy: BodyDecoder = {
      id: 'spy',
      decode(_body, _ct, enc) {
        seen.push(enc)
        return null
      },
    }
    reg.register(spy)
    reg.decode('body', 'text/plain', 'gzip')
    expect(seen[seen.length - 1]).toBe('gzip')
  })
})

import { decodeSse } from '../decoders'

describe('decodeSse — standalone parser', () => {
  test('parses a known SSE stream with event/data/id/retry', () => {
    const stream = [
      'event: update',
      'data: {"n":1}',
      'id: 1',
      'retry: 3000',
      '',
      'event: update',
      'data: {"n":2}',
      'id: 2',
      '',
      'data: no-event-field',
      '',
    ].join('\n')

    const events = decodeSse(stream)
    expect(events).toEqual([
      { event: 'update', data: '{"n":1}', id: '1', retry: 3000 },
      { event: 'update', data: '{"n":2}', id: '2' },
      { data: 'no-event-field' },
    ])
  })

  test('joins multi-line data fields with \\n', () => {
    const stream = ['data: line one', 'data: line two', 'data: line three', ''].join('\n')
    const events = decodeSse(stream)
    expect(events).toEqual([{ data: 'line one\nline two\nline three' }])
  })

  test('ignores comment lines starting with colon', () => {
    const stream = [':this is a comment', 'data: hello', ':another comment', ''].join('\n')
    const events = decodeSse(stream)
    expect(events).toEqual([{ data: 'hello' }])
  })

  test('handles CRLF line endings', () => {
    const stream = 'event: ping\r\ndata: pong\r\n\r\n'
    const events = decodeSse(stream)
    expect(events).toEqual([{ event: 'ping', data: 'pong' }])
  })

  test('flushes a trailing record with no terminating blank line', () => {
    const stream = 'data: trailing'
    const events = decodeSse(stream)
    expect(events).toEqual([{ data: 'trailing' }])
  })

  test('strips a single leading space after the colon but preserves further spaces', () => {
    const stream = 'data:  two spaces\n\n'
    const events = decodeSse(stream)
    expect(events[0]?.data).toBe(' two spaces')
  })

  test('ignores non-numeric retry values', () => {
    const stream = 'data: x\nretry: not-a-number\n\n'
    const events = decodeSse(stream)
    expect(events[0]?.retry).toBeUndefined()
  })

  test('returns empty array for empty body', () => {
    expect(decodeSse('')).toEqual([])
  })

  test('never throws on malformed input', () => {
    expect(() => decodeSse('garbage: nonsense\n\n\n:::')).not.toThrow()
  })
})

describe('bodyDecoders registry — sse content-type detection', () => {
  test('decodes text/event-stream body into JSON event list', () => {
    const bodyDecoders = freshBodyDecoders()
    const stream = 'event: greeting\ndata: hi\nid: 1\n\n'
    const result = bodyDecoders.decode(stream, 'text/event-stream')
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result as string)
    expect(parsed).toEqual([{ event: 'greeting', data: 'hi', id: '1' }])
  })

  test('strips content-type parameters (charset) before matching', () => {
    const bodyDecoders = freshBodyDecoders()
    const stream = 'data: hi\n\n'
    const result = bodyDecoders.decode(stream, 'text/event-stream; charset=utf-8')
    expect(result).not.toBeNull()
  })

  test('no-op for non-SSE content types', () => {
    const bodyDecoders = freshBodyDecoders()
    const body = 'data: hi\n\n'
    const result = bodyDecoders.decode(body, 'text/plain')
    expect(result).toBe(body)
  })
})

import { decodeProtobuf } from '../decoders'

/** Encode a protobuf varint tag + value for hand-built test fixtures. */
function encodeVarint(n: number | bigint): number[] {
  let v = BigInt(n)
  const out: number[] = []
  do {
    let byte = Number(v & 0x7fn)
    v >>= 7n
    if (v !== 0n) byte |= 0x80
    out.push(byte)
  } while (v !== 0n)
  return out
}

function tag(fieldNum: number, wireType: number): number[] {
  return encodeVarint((fieldNum << 3) | wireType)
}

function strBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s))
}

describe('decodeProtobuf — hand-built messages', () => {
  test('decodes a varint field (wire type 0)', () => {
    // field 1, varint value 150 (classic protobuf spec example: 0x08 0x96 0x01)
    const bytes = new Uint8Array([...tag(1, 0), ...encodeVarint(150)])
    const fields = decodeProtobuf(bytes)
    expect(fields).toEqual([{ field: 1, wireType: 0, value: 150n }])
  })

  test('decodes a length-delimited string field (wire type 2)', () => {
    // field 2, wire type 2, length 5, "hello"
    const bytes = new Uint8Array([...tag(2, 2), ...encodeVarint(5), ...strBytes('hello')])
    const fields = decodeProtobuf(bytes)
    expect(fields).toHaveLength(1)
    expect(fields[0]?.field).toBe(2)
    expect(fields[0]?.wireType).toBe(2)
    expect(fields[0]?.isString).toBe(true)
    expect(fields[0]?.value).toBe('hello')
  })

  test('decodes multiple fields of different wire types in one message', () => {
    // field 1 varint=42, field 2 string="hi", field 3 fixed32
    const fixed32Bytes = [0x00, 0x00, 0x80, 0x3f] // 1.0f little-endian
    const bytes = new Uint8Array([
      ...tag(1, 0),
      ...encodeVarint(42),
      ...tag(2, 2),
      ...encodeVarint(2),
      ...strBytes('hi'),
      ...tag(3, 5),
      ...fixed32Bytes,
    ])
    const fields = decodeProtobuf(bytes)
    expect(fields).toHaveLength(3)
    expect(fields[0]).toEqual({ field: 1, wireType: 0, value: 42n })
    expect(fields[1]?.value).toBe('hi')
    expect(fields[2]?.wireType).toBe(5)
    expect(fields[2]?.float).toBeCloseTo(1.0)
  })

  test('recurses into a length-delimited field that parses cleanly as a sub-message', () => {
    // Inner message: field 1, varint 7
    const inner = new Uint8Array([...tag(1, 0), ...encodeVarint(7)])
    // Outer: field 5, wire type 2, length=inner.length, inner bytes
    const outer = new Uint8Array([...tag(5, 2), ...encodeVarint(inner.length), ...inner])
    const fields = decodeProtobuf(outer)
    expect(fields).toHaveLength(1)
    expect(fields[0]?.isMessage).toBe(true)
    const nested = fields[0]?.value as ReturnType<typeof decodeProtobuf>
    expect(nested).toEqual([{ field: 1, wireType: 0, value: 7n }])
  })

  test('renders non-UTF8 length-delimited bytes as hex bytes', () => {
    // Bytes with an invalid UTF-8 continuation and control chars — won't parse as a
    // sub-message (invalid field number when read as tags) and isn't valid text.
    const raw = new Uint8Array([0xff, 0x00, 0x01, 0x02])
    const bytes = new Uint8Array([...tag(9, 2), ...encodeVarint(raw.length), ...raw])
    const fields = decodeProtobuf(bytes)
    expect(fields).toHaveLength(1)
    expect(fields[0]?.isBytes).toBe(true)
    expect(typeof fields[0]?.value).toBe('string')
  })

  test('never throws and returns a partial tree on malformed/truncated input', () => {
    // Valid first field, then a truncated second field (tag says length-delimited length=10 but only 2 bytes follow)
    const bytes = new Uint8Array([...tag(1, 0), ...encodeVarint(5), ...tag(2, 2), ...encodeVarint(10), 0x01, 0x02])
    let fields: ReturnType<typeof decodeProtobuf> = []
    expect(() => {
      fields = decodeProtobuf(bytes)
    }).not.toThrow()
    expect(fields.length).toBeGreaterThanOrEqual(1)
    expect(fields[0]).toEqual({ field: 1, wireType: 0, value: 5n })
  })

  test('returns empty array for empty input', () => {
    expect(decodeProtobuf(new Uint8Array(0))).toEqual([])
  })

  test('never throws on completely random garbage bytes', () => {
    const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
    expect(() => decodeProtobuf(garbage)).not.toThrow()
  })
})

describe('bodyDecoders registry — protobuf-wire decoder', () => {
  test('decodes application/x-protobuf into a readable field tree', () => {
    const bodyDecoders = freshBodyDecoders()
    const bytes = new Uint8Array([...tag(1, 0), ...encodeVarint(42)])
    const b64 = Buffer.from(bytes).toString('base64')
    const result = bodyDecoders.decode(b64, 'application/x-protobuf')
    expect(result).toContain('1 (varint): 42')
  })

  test('no-op for non-protobuf content types', () => {
    const bodyDecoders = freshBodyDecoders()
    const body = 'not protobuf'
    const result = bodyDecoders.decode(body, 'text/plain')
    expect(result).toBe(body)
  })
})

import { decodeGrpcWeb } from '../decoders'

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}

/** Builds a single gRPC-web frame: [compression byte][4-byte BE length][payload]. */
function grpcWebFrame(payload: number[], opts: { trailer?: boolean; compressed?: boolean } = {}): number[] {
  let flag = 0
  if (opts.trailer) flag |= 0x80
  if (opts.compressed) flag |= 0x01
  return [flag, ...u32be(payload.length), ...payload]
}

describe('decodeGrpcWeb — length-prefixed frames', () => {
  test('decodes a single data frame and hands the message to decodeProtobuf', () => {
    const message = [...tag(1, 0), ...encodeVarint(99)]
    const frameBytes = new Uint8Array(grpcWebFrame(message))
    const b64 = Buffer.from(frameBytes).toString('base64')

    const frames = decodeGrpcWeb(b64, 'application/grpc-web+proto')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.isTrailer).toBe(false)
    expect(frames[0]?.compressed).toBe(false)
    expect(frames[0]?.message).toEqual([{ field: 1, wireType: 0, value: 99n }])
  })

  test('decodes multiple data frames followed by a trailer frame', () => {
    const msg1 = [...tag(1, 0), ...encodeVarint(1)]
    const msg2 = [...tag(1, 0), ...encodeVarint(2)]
    const trailerText = 'grpc-status: 0\r\ngrpc-message: OK\r\n'
    const trailerPayload = Array.from(new TextEncoder().encode(trailerText))

    const allBytes = new Uint8Array([
      ...grpcWebFrame(msg1),
      ...grpcWebFrame(msg2),
      ...grpcWebFrame(trailerPayload, { trailer: true }),
    ])
    const b64 = Buffer.from(allBytes).toString('base64')

    const frames = decodeGrpcWeb(b64, 'application/grpc-web+proto')
    expect(frames).toHaveLength(3)
    expect(frames[0]?.message).toEqual([{ field: 1, wireType: 0, value: 1n }])
    expect(frames[1]?.message).toEqual([{ field: 1, wireType: 0, value: 2n }])
    expect(frames[2]?.isTrailer).toBe(true)
    expect(frames[2]?.trailerText).toBe(trailerText)
  })

  test('base64-decodes the whole body first for grpc-web-text', () => {
    const message = [...tag(1, 0), ...encodeVarint(7)]
    const frameBytes = new Uint8Array(grpcWebFrame(message))
    const b64 = Buffer.from(frameBytes).toString('base64')

    const frames = decodeGrpcWeb(b64, 'application/grpc-web-text')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.message).toEqual([{ field: 1, wireType: 0, value: 7n }])
  })

  test('marks the compression flag on a compressed data frame', () => {
    const message = [...tag(1, 0), ...encodeVarint(1)]
    const frameBytes = new Uint8Array(grpcWebFrame(message, { compressed: true }))
    const b64 = Buffer.from(frameBytes).toString('base64')

    const frames = decodeGrpcWeb(b64, 'application/grpc-web+proto')
    expect(frames[0]?.compressed).toBe(true)
  })

  test('never throws on malformed/truncated frame data', () => {
    // Claims a 100-byte payload but only provides 2 bytes
    const truncated = new Uint8Array([0x00, ...u32be(100), 0x01, 0x02])
    const b64 = Buffer.from(truncated).toString('base64')
    expect(() => decodeGrpcWeb(b64, 'application/grpc-web+proto')).not.toThrow()
    const frames = decodeGrpcWeb(b64, 'application/grpc-web+proto')
    expect(frames.length).toBeGreaterThanOrEqual(1)
  })

  test('returns empty array for empty body', () => {
    expect(decodeGrpcWeb('', 'application/grpc-web+proto')).toEqual([])
  })
})

describe('bodyDecoders registry — grpc-web decoder', () => {
  test('decodes application/grpc-web+proto body into readable frame text', () => {
    const bodyDecoders = freshBodyDecoders()
    const message = [...tag(1, 0), ...encodeVarint(5)]
    const frameBytes = new Uint8Array(grpcWebFrame(message))
    const b64 = Buffer.from(frameBytes).toString('base64')

    const result = bodyDecoders.decode(b64, 'application/grpc-web+proto')
    expect(result).toContain('[frame 0] message')
    expect(result).toContain('1 (varint): 5')
  })

  test('decodes application/grpc-web-text body (base64-encoded frames)', () => {
    const bodyDecoders = freshBodyDecoders()
    const message = [...tag(1, 0), ...encodeVarint(3)]
    const frameBytes = new Uint8Array(grpcWebFrame(message))
    const b64 = Buffer.from(frameBytes).toString('base64')

    const result = bodyDecoders.decode(b64, 'application/grpc-web-text')
    expect(result).toContain('[frame 0] message')
  })

  test('surfaces the trailer frame in the formatted output', () => {
    const bodyDecoders = freshBodyDecoders()
    const trailerText = 'grpc-status: 0\r\n'
    const allBytes = new Uint8Array(grpcWebFrame(Array.from(new TextEncoder().encode(trailerText)), { trailer: true }))
    const b64 = Buffer.from(allBytes).toString('base64')

    const result = bodyDecoders.decode(b64, 'application/grpc-web+proto')
    expect(result).toContain('trailer')
    expect(result).toContain('grpc-status: 0')
  })

  test('no-op for non-grpc-web content types', () => {
    const bodyDecoders = freshBodyDecoders()
    const body = 'not grpc-web'
    const result = bodyDecoders.decode(body, 'application/json')
    expect(result).toBe(body)
  })
})
