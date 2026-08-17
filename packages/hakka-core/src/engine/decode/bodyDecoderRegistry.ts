/**
 * BodyDecoder — extensible body decoding pipeline. Register custom decoders to
 * transform raw captured bodies before display; they run in registration order,
 * the first non-null result wins, and the built-in passthrough is the fallback.
 * Built-ins (gzip, deflate, protobuf, sse, grpc-web) are registered on module
 * load by `engine/decoders.ts`.
 */

import { decompressSync, gunzipSync, strFromU8 } from 'fflate'

export interface BodyDecoder {
  /** Unique identifier for this decoder (e.g. "json-pretty", "protobuf", "msgpack"). */
  id: string
  /**
   * Attempt to decode the body.
   * @param body            The raw captured body string.
   * @param contentType     The Content-Type header value (may be undefined).
   * @param contentEncoding The Content-Encoding header value (may be undefined).
   * @returns A decoded/transformed string, or null to defer to the next decoder.
   */
  decode(body: string, contentType: string | undefined, contentEncoding?: string | undefined): string | null
}

/** Built-in passthrough — always returns the body unchanged (last-resort). */
const passthroughDecoder: BodyDecoder = {
  id: '__passthrough__',
  decode(body: string): string {
    return body
  },
}

export class BodyDecoderRegistry {
  private readonly decoders: BodyDecoder[] = []

  /**
   * Register a decoder. Decoders added earlier take precedence.
   * Registering a decoder with a duplicate id replaces the existing one.
   */
  register(decoder: BodyDecoder): void {
    const idx = this.decoders.findIndex((d) => d.id === decoder.id)
    if (idx !== -1) {
      this.decoders[idx] = decoder
    } else {
      this.decoders.push(decoder)
    }
  }

  /**
   * Run the decoder pipeline.
   * Returns the first non-null result from a registered decoder,
   * or the raw body via the built-in passthrough.
   */
  decode(body: string, contentType: string | undefined, contentEncoding?: string | undefined): string {
    for (const decoder of this.decoders) {
      const result = decoder.decode(body, contentType, contentEncoding)
      if (result !== null) return result
    }
    return passthroughDecoder.decode(body, contentType, contentEncoding)
  }
}

/** Singleton registry — shared across the application. */
export const bodyDecoders = new BodyDecoderRegistry()

/**
 * Base64 → Uint8Array. Pure-TS (no Buffer/atob/TextDecoder) so core stays
 * platform-neutral. Returns null when the input is not valid base64. Also
 * used by decode/protobuf.ts and decode/grpcWeb.ts.
 */
const B64_DECODE_LOOKUP: Uint8Array = (() => {
  const t = new Uint8Array(128).fill(255)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  for (let i = 0; i < chars.length; i++) t[chars.charCodeAt(i)] = i
  return t
})()

export function base64ToBytes(b64: string): Uint8Array | null {
  const lookup = B64_DECODE_LOOKUP
  const sextets: number[] = []
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i)
    if (c === 61) break // '=' padding terminates the stream
    const v = c < 128 ? lookup[c] : 255
    if (v !== 255) sextets.push(v)
  }
  const n = sextets.length
  if (n === 0) return b64.length === 0 ? new Uint8Array(0) : null
  const outLen = Math.floor((n * 6) / 8)
  const bytes = new Uint8Array(outLen)
  let acc = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < n; i++) {
    acc = (acc << 6) | sextets[i]
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[o++] = (acc >> bits) & 0xff
    }
  }
  return bytes
}

/**
 * True when `enc` contains `token` (case-insensitive, comma-list aware).
 */
function hasEncoding(enc: string | undefined, token: string): boolean {
  if (!enc) return false
  return enc
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .includes(token)
}

/**
 * Detects base64 bytes starting with the gzip magic (0x1f 0x8b) — a cheap
 * guard against re-decoding already-decoded text once Content-Encoding says gzip.
 */
function looksLikeGzipBase64(body: string): boolean {
  // Only decode the first ~4 base64 chars (3 bytes) — enough to check the
  // magic without parsing the whole body.
  if (body.length < 4) return false
  const prefix = base64ToBytes(body.slice(0, 4).padEnd(4, '='))
  if (!prefix || prefix.length < 2) return false
  return prefix[0] === 0x1f && prefix[1] === 0x8b
}

/**
 * Detect base64-encoded deflate bytes. Content-Encoding: deflate can mean
 * zlib-wrapped (CMF 0x78) or raw deflate (no magic); raw deflate has no
 * reliable signature, so any base64 is accepted as a candidate here —
 * decompression itself validates and throws on non-deflate data.
 */
function looksLikeDeflateBase64(body: string): boolean {
  if (body.length < 4) return false
  const prefix = base64ToBytes(body.slice(0, 4).padEnd(4, '='))
  if (!prefix || prefix.length < 2) return false
  // zlib CMF byte 0x78 = deflate with 32KB window (most common in HTTP)
  if (prefix[0] === 0x78) {
    const flg = prefix[1]
    return flg === 0x01 || flg === 0x5e || flg === 0x9c || flg === 0xda
  }
  // No magic for raw deflate — valid base64 is the only guard (non-ASCII
  // bodies fail decode).
  return prefix !== null
}

export const gzipDecoder: BodyDecoder = {
  id: 'gzip',

  decode(body, _contentType, contentEncoding): string | null {
    if (!hasEncoding(contentEncoding, 'gzip') && !hasEncoding(contentEncoding, 'x-gzip')) return null

    // Most platforms auto-decompress in the normal fetch/XHR path; this decoder
    // is only needed for raw/proxy/native captures that deliver compressed bytes.
    if (!looksLikeGzipBase64(body)) return null

    const bytes = base64ToBytes(body)
    if (!bytes) return null

    try {
      const decompressed = gunzipSync(bytes)
      return strFromU8(decompressed)
    } catch {
      return null
    }
  },
}

export const deflateDecoder: BodyDecoder = {
  id: 'deflate',

  decode(body, _contentType, contentEncoding): string | null {
    if (!hasEncoding(contentEncoding, 'deflate')) return null
    if (!looksLikeDeflateBase64(body)) return null

    const bytes = base64ToBytes(body)
    if (!bytes) return null

    try {
      // decompressSync auto-detects zlib-wrapped deflate and raw deflate
      const decompressed = decompressSync(bytes)
      return strFromU8(decompressed)
    } catch {
      return null
    }
  },
}

const PROTOBUF_CONTENT_TYPES = new Set([
  'application/x-protobuf',
  'application/protobuf',
  'application/vnd.google.protobuf',
  'application/grpc',
  'application/grpc+proto',
])

/**
 * Protobuf/gRPC detection — no schema-less decoding (lossy without a .proto
 * schema); just fingerprints the body and returns a byte-length + hex/base64
 * preview.
 */
export const protobufDetector: BodyDecoder = {
  id: 'protobuf',

  decode(body, contentType): string | null {
    if (!contentType) return null

    // Strip parameters: "application/x-protobuf; charset=binary" → "application/x-protobuf"
    const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
    if (!PROTOBUF_CONTENT_TYPES.has(ct)) return null

    const bytes = base64ToBytes(body)
    const byteLength = bytes ? bytes.length : body.length

    let hexPreview = ''
    if (bytes && bytes.length > 0) {
      const previewBytes = bytes.slice(0, 32)
      hexPreview = Array.from(previewBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')
      if (bytes.length > 32) hexPreview += ' …'
    }

    const lines = [`[protobuf — ${byteLength} bytes]`]
    if (hexPreview) lines.push(`hex: ${hexPreview}`)
    // Raw base64 preview (first 64 chars) for pasting into external decoding tools
    const b64Preview = body.length > 64 ? body.slice(0, 64) + '…' : body
    lines.push(`base64: ${b64Preview}`)

    return lines.join('\n')
  },
}
