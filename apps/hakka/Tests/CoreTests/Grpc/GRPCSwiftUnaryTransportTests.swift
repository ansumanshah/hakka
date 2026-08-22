import Foundation
import GRPCCore
import Testing
@testable import HakkaCore

/// Exercises `GRPCSwiftUnaryTransport` against `TestGrpcUnaryServer` — real
/// sockets, real HTTP/2, plaintext (h2c) — proving the production send path
/// end to end rather than a mocked one, per ADR 0012's verification plan.
@Suite("GRPCSwiftUnaryTransport — real HTTP/2 round trip")
struct GRPCSwiftUnaryTransportTests {
    private func target(port: Int, service: String = "hakka.test.Echo", method: String = "Say") -> GrpcTarget {
        GrpcTarget(host: "127.0.0.1", port: port, useTLS: false, service: service, method: method)
    }

    @Test func unaryRoundTripEchoesMessageAndMetadataWithOkStatus() async throws {
        let server = try await TestGrpcUnaryServer.start(service: "hakka.test.Echo", method: "Say") { metadata, message in
            var responseMetadata = Metadata()
            for (key, value) in metadata where key == "x-request-id" {
                if case let .string(stringValue) = value { responseMetadata.addString(stringValue, forKey: "x-echoed") }
            }
            return TestGrpcOutcome(status: nil, message: message, responseMetadata: responseMetadata)
        }
        defer { Task { await server.stop() } }

        let transport = GRPCSwiftUnaryTransport()
        let request = GrpcUnaryRequest(
            target: target(port: server.port),
            metadata: [GrpcMetadataEntry(name: "x-request-id", value: "abc-123")],
            message: Data([0x0a, 0x03, 0x68, 0x69, 0x21]),
            timeout: 5,
        )

        let response = try await transport.unary(request)

        #expect(response.statusCode == GrpcStatusCode.ok.rawValue)
        #expect(response.message == Data([0x0a, 0x03, 0x68, 0x69, 0x21]))
        #expect(response.initialMetadata.contains { $0.name == "x-echoed" && $0.value == "abc-123" })
    }

    @Test func unaryCallReportsANonOkGrpcStatusWithMessage() async throws {
        let server = try await TestGrpcUnaryServer.start(service: "hakka.test.Echo", method: "Fail") { _, _ in
            TestGrpcOutcome(status: .notFound)
        }
        defer { Task { await server.stop() } }

        let transport = GRPCSwiftUnaryTransport()
        let request = GrpcUnaryRequest(
            target: target(port: server.port, method: "Fail"),
            metadata: [],
            message: Data(),
            timeout: 5,
        )

        let response = try await transport.unary(request)

        #expect(response.statusCode == GrpcStatusCode.notFound.rawValue)
        #expect(response.statusMessage == "test failure")
        #expect(response.message == nil)
    }

    @Test func connectionFailureIsReportedAsUnavailableStatusNotAThrow() async throws {
        // Nothing is listening on this port — a real "server unreachable"
        // case, distinct from the handler-returned-an-error case above.
        let transport = GRPCSwiftUnaryTransport()
        let request = GrpcUnaryRequest(
            target: target(port: 1),
            metadata: [],
            message: Data(),
            timeout: 2,
        )

        let response = try await transport.unary(request)
        #expect(response.statusCode == GrpcStatusCode.unavailable.rawValue)
    }
}
