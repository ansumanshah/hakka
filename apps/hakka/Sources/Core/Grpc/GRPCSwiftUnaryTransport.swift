import Foundation
import GRPCCore
import GRPCNIOTransportHTTP2Posix

/// Passes message bytes through unchanged — gRPC sending (phase 1, ADR 0012)
/// is raw mode only, so there is no generated `SwiftProtobuf` message type
/// to serialize against. `GRPCContiguousBytes`'s `init<Bytes: Sequence>`
/// requirement is what makes this generic over the caller's chosen `Bytes`
/// possible without a `Data`-specific conformance.
private struct GrpcRawBytesSerializer: MessageSerializer {
    func serialize<Bytes: GRPCContiguousBytes>(_ message: [UInt8]) throws -> Bytes {
        Bytes(message)
    }
}

private struct GrpcRawBytesDeserializer: MessageDeserializer {
    func deserialize<Bytes: GRPCContiguousBytes>(_ serializedMessageBytes: Bytes) throws -> [UInt8] {
        var bytes = [UInt8]()
        bytes.reserveCapacity(serializedMessageBytes.count)
        serializedMessageBytes.withUnsafeBytes { bytes.append(contentsOf: $0) }
        return bytes
    }
}

/// Production `GrpcTransport`: one `GRPCClient` per call over
/// `HTTP2ClientTransport.Posix` (h2c for `grpc://`, TLS for `grpcs://`).
/// Sibling to `URLSessionTransport`/`URLSessionWebSocketTransport` — same
/// "thin factory, all the interesting behavior lives in the library/call"
/// shape (ADR 0012).
///
/// A fresh client + connection per call, not pooled: this is a developer
/// manually sending one RPC at a time from a request editor, not a service
/// under sustained load, and a fresh connection means a bad target/TLS/
/// refused connection surfaces on the call that triggered it rather than on
/// a stale pooled connection's next unrelated use.
public struct GRPCSwiftUnaryTransport: GrpcTransport {
    public init() {}

    public func unary(_ request: GrpcUnaryRequest) async throws -> GrpcUnaryResponse {
        let transport = try HTTP2ClientTransport.Posix(
            target: .dns(host: request.target.host, port: request.target.port),
            transportSecurity: request.target.useTLS ? .tls : .plaintext,
        )

        return try await withGRPCClient(transport: transport) { client in
            await Self.performCall(client: client, request: request)
        }
    }

    private static func performCall(
        client: GRPCClient<HTTP2ClientTransport.Posix>,
        request: GrpcUnaryRequest,
    ) async -> GrpcUnaryResponse {
        var metadata = Metadata()
        for entry in request.metadata {
            metadata.addString(entry.value, forKey: entry.name)
        }

        let descriptor = MethodDescriptor(
            service: ServiceDescriptor(fullyQualifiedService: request.target.service),
            method: request.target.method,
        )
        var options = CallOptions.defaults
        if let timeout = request.timeout {
            options.timeout = .milliseconds(Int64((timeout * 1000).rounded()))
        }

        let messageBytes = [UInt8](request.message)
        let clientRequest = ClientRequest<[UInt8]>(message: messageBytes, metadata: metadata)

        do {
            return try await client.unary(
                request: clientRequest,
                descriptor: descriptor,
                serializer: GrpcRawBytesSerializer(),
                deserializer: GrpcRawBytesDeserializer(),
                options: options,
            ) { response in
                Self.unaryResponse(from: response)
            }
        } catch {
            // `GRPCClient.unary` itself only throws for a failure the
            // library couldn't fold into an `RPCError` (e.g. the client was
            // already shut down) — vanishingly rare here since this
            // transport creates one client per call. Reported as
            // `.unavailable`, the same code a connection failure surfaces
            // as, since `GrpcRunner` treats every non-zero `statusCode` the
            // same way `RequestRunner` treats `record.error`.
            return GrpcUnaryResponse(
                initialMetadata: [],
                message: nil,
                trailingMetadata: [],
                statusCode: GrpcStatusCode.unavailable.rawValue,
                statusMessage: String(describing: error),
            )
        }
    }

    private static func unaryResponse(from response: ClientResponse<[UInt8]>) -> GrpcUnaryResponse {
        switch response.accepted {
        case let .success(contents):
            let messageBytes: [UInt8]?
            switch contents.message {
            case let .success(bytes): messageBytes = bytes
            case .failure: messageBytes = nil
            }
            return GrpcUnaryResponse(
                initialMetadata: entries(from: contents.metadata),
                message: messageBytes.map { Data($0) },
                trailingMetadata: entries(from: contents.trailingMetadata),
                statusCode: GrpcStatusCode.ok.rawValue,
                statusMessage: nil,
            )
        case let .failure(error):
            return GrpcUnaryResponse(
                initialMetadata: entries(from: error.metadata),
                message: nil,
                trailingMetadata: entries(from: error.metadata),
                statusCode: error.code.rawValue,
                statusMessage: error.message,
            )
        }
    }

    /// Flattens `GRPCCore.Metadata` (string values only — binary `-bin`
    /// metadata is out of scope for phase 1, matching raw-mode's own scope
    /// cut) into the plain entries `GrpcRunner` folds into `NetworkRequest`
    /// headers.
    private static func entries(from metadata: Metadata) -> [GrpcMetadataEntry] {
        metadata.compactMap { key, value in
            guard case let .string(stringValue) = value else { return nil }
            return GrpcMetadataEntry(name: key, value: stringValue)
        }
    }
}
