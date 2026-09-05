// @generated — do not edit. Synced from ios/Sources/Common/BodyDecoders/WsFrameDecoders+Builtins.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// Singleton WS frame decoder registry, shared across the application,
/// pre-populated with Hakka's built-in decoders in the same order as
/// `wsDecoders.ts`'s module-load registration: `graphql-ws`/`stomp` are
/// protocol-matched (more specific) and register before `socket.io`, the
/// content-matched universal fallback.
public let wsFrameDecoders: WsFrameDecoderRegistry = {
    let registry = WsFrameDecoderRegistry()
    registry.register(MqttWsFrameDecoder())
    registry.register(GraphqlWsFrameDecoder())
    registry.register(StompWsFrameDecoder())
    registry.register(SocketIoWsFrameDecoder())
    return registry
}()

/// Convenience wrapper — calls the singleton registry. Port of
/// `wsDecoders.ts`'s `decodeWsFrame`.
public func decodeWsFrame(_ payload: WsPayload, binary: Bool, wsProtocol: String? = nil) -> WsFrameInfo? {
    wsFrameDecoders.decode(payload, binary: binary, wsProtocol: wsProtocol)
}
