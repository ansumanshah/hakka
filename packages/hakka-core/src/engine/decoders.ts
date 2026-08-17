/**
 * BodyDecoder — extensible body decoding pipeline for Hakka. Thin re-export
 * shim over the decoder families in `engine/decode/` (registry/gzip/deflate,
 * sse, protobuf, grpc-web), so nothing outside — or `src/index.ts` inside —
 * has to know about the split.
 */
import {
  bodyDecoders,
  deflateDecoder,
  gzipDecoder,
  protobufDetector,
  type BodyDecoder,
} from './decode/bodyDecoderRegistry'
import { decodeGrpcWeb, grpcWebDecoder, type GrpcWebFrame } from './decode/grpcWeb'
import { decodeProtobuf, protobufWireDecoder, type ProtoField } from './decode/protobuf'
import { decodeSse, sseDecoder, type SseEvent } from './decode/sse'

export type { BodyDecoder, SseEvent, ProtoField, GrpcWebFrame }
export { bodyDecoders, decodeSse, decodeProtobuf, decodeGrpcWeb }

// Register built-in decoders on module load. Order matters: gzip/deflate run before protobuf
// so a compressed protobuf body decompresses first. sse/protobuf-wire/grpc-web are
// content-type gated and mutually exclusive, so their order doesn't change behavior — except
// grpc-web must be checked before protobuf-wire so an `application/grpc-web+proto` body can
// never be shadowed.
bodyDecoders.register(gzipDecoder)
bodyDecoders.register(deflateDecoder)
bodyDecoders.register(sseDecoder)
bodyDecoders.register(grpcWebDecoder)
bodyDecoders.register(protobufWireDecoder)
bodyDecoders.register(protobufDetector)
