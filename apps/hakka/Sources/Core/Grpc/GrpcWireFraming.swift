import Foundation

/// Wraps a raw gRPC message in the standard 5-byte length-prefixed frame
/// (1-byte compression flag + 4-byte big-endian length + payload) — the
/// wire shape `GrpcBodyDecoder` already parses for captured traffic.
///
/// `GRPCCore`'s `MessageSerializer`/`MessageDeserializer` operate on
/// *unframed* message bytes; framing is the transport layer's job and is
/// invisible to a `GrpcTransport` caller. `GrpcRunner` uses this only to
/// build the synthetic `NetworkRequest.requestBody`/`responseBody` it feeds
/// into the same decoder a passive capture would produce — see ADR 0012.
enum GrpcWireFraming {
    static func encodeFrame(_ payload: Data, compressed: Bool = false) -> Data {
        var frame = Data(capacity: 5 + payload.count)
        frame.append(compressed ? 1 : 0)
        let length = UInt32(payload.count).bigEndian
        withUnsafeBytes(of: length) { frame.append(contentsOf: $0) }
        frame.append(payload)
        return frame
    }
}
