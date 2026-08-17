import Foundation

/// Singleton body-decoder registry, shared across the application, pre-populated
/// with Hakka's built-in decoders in the same order as `decoders.ts`'s
/// module-load registration:
///
/// gzip and deflate run before protobuf so a compressed protobuf body can be
/// decompressed first. sse / protobuf-wire / grpc-web are content-type gated
/// and mutually exclusive with each other and with the legacy `protobuf`
/// preview, so registration order among them doesn't change behavior — but
/// grpc-web is checked before protobuf-wire so an `application/grpc-web+proto`
/// body (which isn't in the x-protobuf set) can never be shadowed.
public let bodyDecoders: BodyDecoderRegistry = {
    let registry = BodyDecoderRegistry()
    registry.register(GzipBodyDecoder())
    registry.register(DeflateBodyDecoder())
    registry.register(SseBodyDecoder())
    registry.register(GrpcWebBodyDecoder())
    registry.register(ProtobufWireBodyDecoder())
    registry.register(LegacyProtobufBodyDecoder())
    return registry
}()
