import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

private struct StubGrpcTransport: GrpcTransport {
    let handler: @Sendable (GrpcUnaryRequest) async throws -> GrpcUnaryResponse

    func unary(_ request: GrpcUnaryRequest) async throws -> GrpcUnaryResponse {
        try await handler(request)
    }
}

private func okResponse(message: Data, statusMessage: String? = nil) -> GrpcUnaryResponse {
    GrpcUnaryResponse(
        initialMetadata: [GrpcMetadataEntry(name: "x-server", value: "hakka-test")],
        message: message,
        trailingMetadata: [],
        statusCode: GrpcStatusCode.ok.rawValue,
        statusMessage: statusMessage,
    )
}

@Suite("GrpcRunner")
struct GrpcRunnerTests {
    private func collection() -> Collection { Collection(name: "C") }

    @Test func resolvesTargetFromURLAndSendsInterpolatedMetadataAndMessage() async throws {
        let capturedRequest = CapturedGrpcRequest()
        let runner = GrpcRunner(transport: StubGrpcTransport { request in
            await capturedRequest.set(request)
            return okResponse(message: Data([0x01, 0x02]))
        })

        let scope = VariableScope(environment: ["token": "secret-token"])
        let request = RequestSpec(
            name: "R",
            url: "grpc://localhost:50051/myapp.UserService/GetUser",
            headers: [HeaderPair(name: "Authorization", value: "Bearer {{token}}")],
            body: .grpcMessage(hex: "0a03616263"),
        )

        _ = try await runner.run(request, collection: collection(), scope: scope)

        let sent = try #require(await capturedRequest.value)
        #expect(sent.target.host == "localhost")
        #expect(sent.target.port == 50051)
        #expect(sent.target.service == "myapp.UserService")
        #expect(sent.target.method == "GetUser")
        #expect(sent.message == Data([0x0a, 0x03, 0x61, 0x62, 0x63]))
        #expect(sent.metadata.contains { $0.name == "Authorization" && $0.value == "Bearer secret-token" })
    }

    /// The synthesized "Content-Type: application/grpc" header
    /// (`BodySpec.grpcMessage.contentTypeHeader`) is for the display record
    /// only — sending it as gRPC metadata would be redundant at best.
    @Test func contentTypeHeaderIsNotSentAsMetadata() async throws {
        let capturedRequest = CapturedGrpcRequest()
        let runner = GrpcRunner(transport: StubGrpcTransport { request in
            await capturedRequest.set(request)
            return okResponse(message: Data())
        })
        let request = RequestSpec(name: "R", url: "grpc://localhost:50051/pkg.Svc/M", body: .grpcMessage(hex: ""))

        _ = try await runner.run(request, collection: collection(), scope: VariableScope())

        let sent = try #require(await capturedRequest.value)
        #expect(!sent.metadata.contains { $0.name.caseInsensitiveCompare("content-type") == .orderedSame })
    }

    @Test func missingVariableRefusesToSend() async {
        let runner = GrpcRunner(transport: StubGrpcTransport { _ in okResponse(message: Data()) })
        let request = RequestSpec(name: "R", url: "grpc://localhost:50051/pkg.Svc/{{missing}}")

        await #expect(throws: RequestRunnerError.self) {
            try await runner.run(request, collection: collection(), scope: VariableScope())
        }
    }

    @Test func malformedTargetPathRefusesBeforeSending() async {
        let runner = GrpcRunner(transport: StubGrpcTransport { _ in okResponse(message: Data()) })
        // Only one path segment — not a valid /Service/Method target.
        let request = RequestSpec(name: "R", url: "grpc://localhost:50051/onlyOneSegment")

        await #expect(throws: RequestRunnerError.self) {
            try await runner.run(request, collection: collection(), scope: VariableScope())
        }
    }

    @Test func preflightTransportFailureIsRecordedNotThrown() async throws {
        struct BoomError: Error {}
        let runner = GrpcRunner(transport: StubGrpcTransport { _ in throw BoomError() })
        let request = RequestSpec(name: "R", url: "grpc://localhost:50051/pkg.Svc/M")

        let result = try await runner.run(request, collection: collection(), scope: VariableScope())
        #expect(result.record.error != nil)
        #expect(result.record.status == nil)
    }

    /// The response decodes through the exact same `GrpcBodyDecoder` a
    /// passive capture uses — proving ADR 0012's "reuse the existing
    /// decoders, don't duplicate" claim rather than asserting it.
    @Test func responseDecodesThroughTheExistingGrpcBodyDecoder() async throws {
        // A real length-prefixed field tree: field 1 varint 42, field 2 string "hakka".
        let messageBytes = Data([0x08, 0x2a, 0x12, 0x05, 0x68, 0x61, 0x6b, 0x6b, 0x61])
        let runner = GrpcRunner(transport: StubGrpcTransport { _ in okResponse(message: messageBytes) })
        let request = RequestSpec(name: "R", url: "grpc://localhost:50051/pkg.Svc/M", body: .grpcMessage(hex: ""))

        let result = try await runner.run(request, collection: collection(), scope: VariableScope())
        let record = result.record

        #expect(record.contentType == "application/grpc")
        let responseBody = try #require(record.responseBody)
        let decoded = GrpcBodyDecoder.decode(rawBase64Text: responseBody, contentType: record.contentType, responseHeaders: record.responseHeaders)

        #expect(decoded.frames.count == 1)
        guard case let .fields(fields) = decoded.frames[0].payload else {
            Issue.record("expected a decoded field tree")
            return
        }
        #expect(fields.count == 2)
        #expect(fields[0].value == .varint(42))
        #expect(fields[1].value == .string("hakka"))

        let status = try #require(decoded.status)
        #expect(status.known == .ok)
        #expect(status.source == .trailersOnlyResponseHeader)
    }

    /// A non-OK gRPC status must be visible through the same
    /// `trailersOnlyResponseHeader` path — this is the whole reason ADR
    /// 0010 deferred sending in the first place (URLSession can't retain
    /// real trailers at all).
    @Test func nonOkStatusAndMessageSurfaceThroughTheDecoder() async throws {
        let response = GrpcUnaryResponse(
            initialMetadata: [],
            message: nil,
            trailingMetadata: [],
            statusCode: GrpcStatusCode.notFound.rawValue,
            statusMessage: "user not found",
        )
        let runner = GrpcRunner(transport: StubGrpcTransport { _ in response })
        let request = RequestSpec(name: "R", url: "grpc://localhost:50051/pkg.Svc/M", body: .grpcMessage(hex: ""))

        let result = try await runner.run(request, collection: collection(), scope: VariableScope())
        let record = result.record

        #expect(record.responseHeaders["grpc-status"] == ["5"])
        #expect(record.responseHeaders["grpc-message"] == ["user not found"])
        #expect(record.status == nil, "gRPC status, not HTTP status, is the real outcome here")

        let decoded = GrpcBodyDecoder.decode(rawBase64Text: "", contentType: record.contentType, responseHeaders: record.responseHeaders)
        let status = try #require(decoded.status)
        #expect(status.known == .notFound)
        #expect(status.message == "user not found")
        #expect(status.source == .trailersOnlyResponseHeader)
    }
}

/// Thread-safe capture of the one `GrpcUnaryRequest` a stub transport
/// received — the same "was this called with what" shape
/// `RunnerTests.CallFlag` uses, generalized to hold a value.
private actor CapturedGrpcRequest {
    private(set) var value: GrpcUnaryRequest?
    func set(_ request: GrpcUnaryRequest) { value = request }
}
