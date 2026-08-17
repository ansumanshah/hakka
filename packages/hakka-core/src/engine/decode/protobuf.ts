import { base64ToBytes, type BodyDecoder } from './bodyDecoderRegistry'

// Best-effort wire-format decoder — no .proto schema required.

/** Wire types defined by the protobuf encoding spec. */
type ProtoWireType = 0 | 1 | 2 | 5

/** A single decoded protobuf field in the best-effort field tree. */
export interface ProtoField {
  /** The field number from the tag. */
  field: number
  /** The wire type from the tag (0=varint, 1=64-bit, 2=length-delimited, 5=32-bit). */
  wireType: ProtoWireType
  /**
   * The decoded value, shaped by wireType: 0/1 → bigint (safe for full 64-bit
   * range), 5 → number, 2 → nested ProtoField[] when it parses cleanly as a
   * sub-message, else a UTF-8 `string`, else hex-encoded `bytes` as a last resort.
   */
  value: bigint | number | string | ProtoField[]
  /** For wireType 1, the bits reinterpreted as a double. */
  double?: number
  /** For wireType 5, the bits reinterpreted as a float. */
  float?: number
  /** For wireType 2 values that decoded as a nested message, this is always true. */
  isMessage?: boolean
  /** For wireType 2 values that fell back to a string. */
  isString?: boolean
  /** For wireType 2 values that fell back to raw bytes (hex string in `value`). */
  isBytes?: boolean
}

class ProtoReader {
  private pos = 0
  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.pos
  }

  eof(): boolean {
    return this.pos >= this.bytes.length
  }

  readByte(): number {
    if (this.pos >= this.bytes.length) throw new Error('unexpected EOF')
    return this.bytes[this.pos++]!
  }

  /** Reads a base-128 varint, returning a bigint (safe for full 64-bit range). */
  readVarint(): bigint {
    let result = 0n
    let shift = 0n
    for (let i = 0; i < 10; i++) {
      const b = this.readByte()
      result |= BigInt(b & 0x7f) << shift
      if ((b & 0x80) === 0) return result
      shift += 7n
    }
    throw new Error('varint too long')
  }

  readFixed64(): bigint {
    if (this.remaining < 8) throw new Error('unexpected EOF (fixed64)')
    let result = 0n
    for (let i = 0; i < 8; i++) {
      result |= BigInt(this.bytes[this.pos + i]!) << BigInt(8 * i)
    }
    this.pos += 8
    return result
  }

  readFixed32(): number {
    if (this.remaining < 4) throw new Error('unexpected EOF (fixed32)')
    const b = this.bytes
    const p = this.pos
    const result = (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0
    this.pos += 4
    return result
  }

  readBytes(len: number): Uint8Array {
    if (len < 0 || this.remaining < len) throw new Error('unexpected EOF (length-delimited)')
    const slice = this.bytes.subarray(this.pos, this.pos + len)
    this.pos += len
    return slice
  }
}

function bigintBitsToDouble(bits: bigint): number {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setBigUint64(0, bits, true)
  return new DataView(buf).getFloat64(0, true)
}

function bitsToFloat(bits: number): number {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setUint32(0, bits, true)
  return new DataView(buf).getFloat32(0, true)
}

/**
 * True when `bytes` looks like valid, printable-ish UTF-8 text.
 * Used to decide whether a length-delimited field should render as a string
 * instead of raw hex bytes.
 */
function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true
  let i = 0
  let printable = 0
  while (i < bytes.length) {
    const b = bytes[i]!
    if (b === 0x09 || b === 0x0a || b === 0x0d) {
      printable++
      i++
      continue
    }
    if (b < 0x20 || b === 0x7f) return false // control chars — not text
    if (b < 0x80) {
      printable++
      i++
      continue
    }
    // Multi-byte UTF-8 sequence lengths
    let extra: number
    if ((b & 0xe0) === 0xc0) extra = 1
    else if ((b & 0xf0) === 0xe0) extra = 2
    else if ((b & 0xf8) === 0xf0) extra = 3
    else return false
    if (i + extra >= bytes.length) return false
    for (let j = 1; j <= extra; j++) {
      if ((bytes[i + j]! & 0xc0) !== 0x80) return false
    }
    printable++
    i += extra + 1
  }
  return printable > 0
}

// Exported: also used by decode/grpcWeb.ts to render trailer text (plain
// header-style bytes, not protobuf, but the same UTF-8 decode applies).
export function bytesToUtf8(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]!
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i++
    } else if ((b & 0xe0) === 0xc0) {
      const cp = ((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f)
      out += String.fromCharCode(cp)
      i += 2
    } else if ((b & 0xf0) === 0xe0) {
      const cp = ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f)
      out += String.fromCharCode(cp)
      i += 3
    } else {
      const cp =
        ((b & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f)
      out += String.fromCodePoint(cp)
      i += 4
    }
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0')
  return out
}

/**
 * Attempt to parse `bytes` as a nested protobuf sub-message; null if it
 * doesn't look like a valid message (decides recurse vs. string/bytes).
 */
function tryParseSubMessage(bytes: Uint8Array): ProtoField[] | null {
  if (bytes.length === 0) return []
  try {
    const fields = parseProtoFields(new ProtoReader(bytes))
    if (fields.length === 0) return null
    return fields
  } catch {
    return null
  }
}

/**
 * Classify a length-delimited (wire type 2) payload as a nested sub-message,
 * a UTF-8 string, or raw bytes. Schema-less decoding is inherently ambiguous
 * here — short byte sequences (e.g. "hi") can accidentally parse as a valid
 * tag+varint pair — so plain printable text always wins over an ambiguous
 * sub-message interpretation: recursion only happens when the bytes do NOT
 * look like clean text.
 */
function classifyLengthDelimited(
  raw: Uint8Array,
): { kind: 'message'; fields: ProtoField[] } | { kind: 'string'; text: string } | { kind: 'bytes'; hex: string } {
  const isText = looksLikeUtf8Text(raw)
  if (!isText) {
    const sub = tryParseSubMessage(raw)
    if (sub !== null) return { kind: 'message', fields: sub }
    return { kind: 'bytes', hex: bytesToHex(raw) }
  }
  return { kind: 'string', text: bytesToUtf8(raw) }
}

/** Parses all top-level fields out of a ProtoReader until EOF. Throws on malformed data. */
function parseProtoFields(reader: ProtoReader): ProtoField[] {
  const fields: ProtoField[] = []
  while (!reader.eof()) {
    const tag = reader.readVarint()
    const fieldNum = Number(tag >> 3n)
    const wireType = Number(tag & 0x7n) as ProtoWireType
    if (fieldNum < 1) throw new Error('invalid field number')

    switch (wireType) {
      case 0: {
        const value = reader.readVarint()
        fields.push({ field: fieldNum, wireType, value })
        break
      }
      case 1: {
        const bits = reader.readFixed64()
        fields.push({ field: fieldNum, wireType, value: bits, double: bigintBitsToDouble(bits) })
        break
      }
      case 5: {
        const bits = reader.readFixed32()
        fields.push({ field: fieldNum, wireType, value: bits, float: bitsToFloat(bits) })
        break
      }
      case 2: {
        const len = Number(reader.readVarint())
        const raw = reader.readBytes(len)
        const classified = classifyLengthDelimited(raw)
        if (classified.kind === 'message') {
          fields.push({ field: fieldNum, wireType, value: classified.fields, isMessage: true })
        } else if (classified.kind === 'string') {
          fields.push({ field: fieldNum, wireType, value: classified.text, isString: true })
        } else {
          fields.push({ field: fieldNum, wireType, value: classified.hex, isBytes: true })
        }
        break
      }
      default: {
        // Wire type 3/4 (deprecated groups) or unrecognized — bail out of this level.
        throw new Error(`unsupported wire type ${wireType}`)
      }
    }
  }
  return fields
}

/**
 * Best-effort protobuf wire-format decoder — no .proto schema required. Walks
 * the bytes as (field number, wire type) tags; length-delimited values recurse
 * as nested sub-messages when they decode cleanly, else UTF-8 text, else hex
 * bytes. Never throws — malformed/truncated input yields a partial tree.
 */
export function decodeProtobuf(bytes: Uint8Array): ProtoField[] {
  try {
    return parseProtoFields(new ProtoReader(bytes))
  } catch {
    // Re-parse field-by-field, collecting until the failure point, so a
    // malformed tail doesn't erase an otherwise-valid prefix.
    const partial: ProtoField[] = []
    const reader = new ProtoReader(bytes)
    try {
      while (!reader.eof()) {
        const before = reader.remaining
        const tag = reader.readVarint()
        const fieldNum = Number(tag >> 3n)
        const wireType = Number(tag & 0x7n) as ProtoWireType
        if (fieldNum < 1) break

        if (wireType === 0) {
          partial.push({ field: fieldNum, wireType, value: reader.readVarint() })
        } else if (wireType === 1) {
          const bits = reader.readFixed64()
          partial.push({ field: fieldNum, wireType, value: bits, double: bigintBitsToDouble(bits) })
        } else if (wireType === 5) {
          const bits = reader.readFixed32()
          partial.push({ field: fieldNum, wireType, value: bits, float: bitsToFloat(bits) })
        } else if (wireType === 2) {
          const len = Number(reader.readVarint())
          const raw = reader.readBytes(len)
          const classified = classifyLengthDelimited(raw)
          if (classified.kind === 'message')
            partial.push({ field: fieldNum, wireType, value: classified.fields, isMessage: true })
          else if (classified.kind === 'string')
            partial.push({ field: fieldNum, wireType, value: classified.text, isString: true })
          else partial.push({ field: fieldNum, wireType, value: classified.hex, isBytes: true })
        } else {
          break
        }

        // Safety valve: stop if no progress was made, to avoid an infinite loop.
        if (reader.remaining >= before) break
      }
    } catch {
      // Swallow — return whatever was accumulated so far.
    }
    return partial
  }
}

/** Render a ProtoField tree as an indented, human-readable string (used by the registry decoder). */
export function formatProtoFields(fields: ProtoField[], indent = 0): string {
  const pad = '  '.repeat(indent)
  const lines: string[] = []
  for (const f of fields) {
    if (f.isMessage) {
      lines.push(`${pad}${f.field} (message):`)
      lines.push(formatProtoFields(f.value as ProtoField[], indent + 1))
    } else if (f.isString) {
      lines.push(`${pad}${f.field} (string): ${JSON.stringify(f.value)}`)
    } else if (f.isBytes) {
      lines.push(`${pad}${f.field} (bytes): ${f.value}`)
    } else if (f.wireType === 1) {
      lines.push(`${pad}${f.field} (fixed64): ${f.value} (double: ${f.double})`)
    } else if (f.wireType === 5) {
      lines.push(`${pad}${f.field} (fixed32): ${f.value} (float: ${f.float})`)
    } else {
      lines.push(`${pad}${f.field} (varint): ${f.value}`)
    }
  }
  return lines.join('\n')
}

const PROTOBUF_WIRE_CONTENT_TYPES = new Set(['application/x-protobuf', 'application/protobuf'])

/**
 * Registry decoder for standalone protobuf bodies (not gRPC-wrapped) — runs
 * the full wire-format walk and returns a readable field tree. Distinct id
 * from `protobuf` (which only fingerprints with a hex/base64 preview) and
 * registered first, so `application/x-protobuf`/`application/protobuf` get
 * the decoded tree while `application/grpc`/`application/grpc+proto` (unary
 * gRPC) still fall through to the lightweight preview.
 */
export const protobufWireDecoder: BodyDecoder = {
  id: 'protobuf-wire',

  decode(body, contentType): string | null {
    if (!contentType) return null
    const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
    if (!PROTOBUF_WIRE_CONTENT_TYPES.has(ct)) return null

    const bytes = base64ToBytes(body)
    if (!bytes || bytes.length === 0) return null

    const fields = decodeProtobuf(bytes)
    if (fields.length === 0) return null
    return formatProtoFields(fields)
  },
}
