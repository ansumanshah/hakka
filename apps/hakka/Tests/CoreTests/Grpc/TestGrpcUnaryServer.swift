import Foundation
import GRPCCore
import GRPCNIOTransportHTTP2Posix

/// Bytes-passthrough serializer/deserializer for the test server — the same
/// codec `GRPCSwiftUnaryTransport` uses on the client side, duplicated here
/// (not `@testable import`ed) because it's a two-line conformance and the
/// production one is `private` to its file.
private struct PassthroughSerializer: MessageSerializer {
    func serialize<Bytes: GRPCContiguousBytes>(_ message: [UInt8]) throws -> Bytes { Bytes(message) }
}

private struct PassthroughDeserializer: MessageDeserializer {
    func deserialize<Bytes: GRPCContiguousBytes>(_ serializedMessageBytes: Bytes) throws -> [UInt8] {
        var bytes = [UInt8]()
        bytes.reserveCapacity(serializedMessageBytes.count)
        serializedMessageBytes.withUnsafeBytes { bytes.append(contentsOf: $0) }
        return bytes
    }
}

enum TestGrpcServerError: Error {
    case bindFailed
}

/// What a registered test handler returns for one call: either a message
/// (`status == nil`, i.e. OK) or a specific failing status — never both.
struct TestGrpcOutcome: Sendable {
    var status: RPCError.Code?
    var message: [UInt8] = []
    var responseMetadata: Metadata = [:]
    var trailingMetadata: Metadata = [:]
}

/// A real gRPC server — grpc-swift-2's own `GRPCServer`, over
/// `HTTP2ServerTransport.Posix`, plaintext (h2c), bound to an OS-assigned
/// loopback port — running inside the test process for the duration of one
/// test. Proves `GRPCSwiftUnaryTransport` against a real HTTP/2 round trip
/// rather than a mock, per ADR 0012's verification plan. Not shipped: this
/// type lives only in `HakkaCoreTests`.
final class TestGrpcUnaryServer: Sendable {
    typealias Handler = @Sendable (_ metadata: Metadata, _ message: [UInt8]) async -> TestGrpcOutcome

    let port: Int
    private let server: GRPCServer<HTTP2ServerTransport.Posix>
    private let serveTask: Task<Void, Never>

    private init(port: Int, server: GRPCServer<HTTP2ServerTransport.Posix>, serveTask: Task<Void, Never>) {
        self.port = port
        self.server = server
        self.serveTask = serveTask
    }

    static func start(service: String, method: String, handler: @escaping Handler) async throws -> TestGrpcUnaryServer {
        let transport = HTTP2ServerTransport.Posix(
            address: .ipv4(host: "127.0.0.1", port: 0),
            transportSecurity: .plaintext,
        )

        var router = RPCRouter<HTTP2ServerTransport.Posix>()
        router.registerHandler(
            forMethod: MethodDescriptor(service: ServiceDescriptor(fullyQualifiedService: service), method: method),
            deserializer: PassthroughDeserializer(),
            serializer: PassthroughSerializer(),
        ) { request, _ in
            var iterator = request.messages.makeAsyncIterator()
            let message = (try? await iterator.next()) ?? []
            let outcome = await handler(request.metadata, message)
            if let code = outcome.status {
                let error = RPCError(code: code, message: "test failure", metadata: outcome.trailingMetadata)
                return StreamingServerResponse(single: ServerResponse(of: [UInt8].self, error: error))
            }
            return StreamingServerResponse(single: ServerResponse(
                message: outcome.message,
                metadata: outcome.responseMetadata,
                trailingMetadata: outcome.trailingMetadata,
            ))
        }

        let server = GRPCServer(transport: transport, router: router)
        let serveTask = Task {
            do { try await server.serve() } catch {}
        }

        guard let ipv4 = try await transport.listeningAddress.ipv4 else {
            serveTask.cancel()
            throw TestGrpcServerError.bindFailed
        }
        return TestGrpcUnaryServer(port: ipv4.port, server: server, serveTask: serveTask)
    }

    func stop() async {
        server.beginGracefulShutdown()
        serveTask.cancel()
        _ = await serveTask.value
    }
}
