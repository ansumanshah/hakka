import { base64ToBytes, type BodyDecoder } from './bodyDecoderRegistry'
import { bytesToUtf8, decodeProtobuf, formatProtoFields, type ProtoField } from './protobuf'

/** A single length-prefixed gRPC-web frame. */
export interface GrpcWebFrame {
  /** True when this frame is the trailer frame (MSB of the compression byte is set: 0x80). */
  isTrailer: boolean
  /** True when the frame's own payload was gzip-compressed (LSB of the compression byte). */
  compressed: boolean
  /** Byte length of the frame's message payload, per the 4-byte big-endian length prefix. */
  length: number
  /**
   * The decoded message. For data frames, this is the best-effort protobuf field
   * tree (see `decodeProtobuf`). For the trailer frame, gRPC-web trailers are
   * HTTP/1.1-style "Key: Value\r\n" text, not protobuf, so `message` is omitted
   * and the raw text is exposed via `trailerText` instead.
   */
  message?: ProtoField[]
  /** Raw trailer text (only set when `isTrailer` is true). */
  trailerText?: string
}

/**
 * Decode a gRPC-web body into its length-prefixed frames: [1 compression
 * byte][4-byte big-endian length][message bytes], repeated. The compression
 * byte's high bit (0x80) marks a trailer frame; gRPC-web trailers are plain
 * HTTP-header-style text ("grpc-status: 0\r\n"), not a protobuf message.
 * `application/grpc-web-text` (and `+text`) bodies are base64-encoded as a
 * whole and get base64-decoded before unframing, based on `contentType`.
 * Never throws — returns whatever frames were parsed before any failure.
 */
export function decodeGrpcWeb(body: string, contentType?: string): GrpcWebFrame[] {
  const ct = (contentType ?? '').toLowerCase()
  const isText = ct.includes('grpc-web-text') || ct.includes('grpc-web+text')

  let bytes: Uint8Array
  if (isText) {
    const decoded = base64ToBytes(body)
    if (!decoded) return []
    bytes = decoded
  } else {
    // Non-text grpc-web frames still arrive through this pipeline as base64
    // (captures ship bodies as base64/text), so decode unconditionally; if
    // that fails, treat the body as already-raw bytes via latin1 mapping.
    const decoded = base64ToBytes(body)
    if (decoded) {
      bytes = decoded
    } else {
      bytes = new Uint8Array(body.length)
      for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xff
    }
  }

  const frames: GrpcWebFrame[] = []
  let pos = 0
  try {
    while (pos + 5 <= bytes.length) {
      const compressionByte = bytes[pos]!
      const isTrailer = (compressionByte & 0x80) !== 0
      const compressed = (compressionByte & 0x01) !== 0
      const length =
        ((bytes[pos + 1]! << 24) | (bytes[pos + 2]! << 16) | (bytes[pos + 3]! << 8) | bytes[pos + 4]!) >>> 0
      pos += 5
      if (pos + length > bytes.length) {
        // Truncated final frame — surface what's available (empty message) and stop.
        const partialPayload = bytes.subarray(pos)
        if (isTrailer) {
          frames.push({ isTrailer, compressed, length, trailerText: bytesToUtf8(partialPayload) })
        } else {
          frames.push({ isTrailer, compressed, length, message: decodeProtobuf(partialPayload) })
        }
        break
      }
      const payload = bytes.subarray(pos, pos + length)
      pos += length

      if (isTrailer) {
        frames.push({ isTrailer, compressed, length, trailerText: bytesToUtf8(payload) })
      } else {
        // Compressed frames can't be inflated without knowing the codec; decode
        // as protobuf regardless — an empty/partial tree is still useful signal,
        // since the frame is at least identified and length-correct.
        frames.push({ isTrailer, compressed, length, message: decodeProtobuf(payload) })
      }
    }
  } catch {
    // Swallow — return whatever frames were parsed so far.
  }

  return frames
}

function formatGrpcWebFrames(frames: GrpcWebFrame[]): string {
  const lines: string[] = []
  frames.forEach((frame, i) => {
    if (frame.isTrailer) {
      lines.push(`[frame ${i}] trailer (${frame.length} bytes):`)
      lines.push(frame.trailerText ?? '')
    } else {
      lines.push(`[frame ${i}] message (${frame.length} bytes${frame.compressed ? ', compressed' : ''}):`)
      lines.push(formatProtoFields(frame.message ?? []))
    }
  })
  return lines.join('\n')
}

const GRPC_WEB_CONTENT_TYPES = [
  'application/grpc-web',
  'application/grpc-web+proto',
  'application/grpc-web-text',
  'application/grpc-web+text',
]

export const grpcWebDecoder: BodyDecoder = {
  id: 'grpc-web',

  decode(body, contentType): string | null {
    if (!contentType) return null
    const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
    if (!GRPC_WEB_CONTENT_TYPES.includes(ct)) return null

    const frames = decodeGrpcWeb(body, ct)
    if (frames.length === 0) return null
    return formatGrpcWebFrames(frames)
  },
}
