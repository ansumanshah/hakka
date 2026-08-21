import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

/// Verifies `GrpcBodyDecoder` against pinned real gRPC wire frames in
/// `fixtures/grpc/` (see its README). Covers frame structure, the
/// compression flag, truncation safety, and the two ways a gRPC status can
/// actually be resolved from what `NetworkRequest` captures today.
@Suite("GrpcBodyDecoder — frames and status")
struct GrpcBodyDecoderTests {
    @Test
    func decodesAUnaryMessageFrame() throws {
        let b64 = try GrpcFixtures.readBase64("unary-message.bin")
        let decoded = GrpcBodyDecoder.decode(rawBase64Text: b64, contentType: "application/grpc-web+proto", responseHeaders: [:])

        #expect(decoded.frames.count == 1)
        let frame = try #require(decoded.frames.first)
        #expect(frame.compressed == false)
        #expect(frame.byteLength == 9)
        guard case .fields(let fields) = frame.payload else {
            Issue.record("expected a decoded field tree")
            return
        }
        #expect(fields.count == 2)
        #expect(fields[0].field == 1)
        #expect(fields[0].value == .varint(42))
        #expect(fields[1].field == 2)
        #expect(fields[1].value == .string("hakka"))
    }

    @Test
    func rendersMultipleMessagesAsSeparateStreamFrames() throws {
        let b64 = try GrpcFixtures.readBase64("streaming-messages.bin")
        let decoded = GrpcBodyDecoder.decode(rawBase64Text: b64, contentType: "application/grpc-web+proto", responseHeaders: [:])

        #expect(decoded.frames.count == 2)
        #expect(decoded.frames.map(\.id) == [0, 1])
        for frame in decoded.frames {
            guard case .fields(let fields) = frame.payload else {
                Issue.record("expected a decoded field tree for frame \(frame.id)")
                continue
            }
            #expect(fields.count == 2)
        }
    }

    @Test
    func compressedFrameIsFlaggedNotInflatedRatherThanDecodedAsGarbage() throws {
        let b64 = try GrpcFixtures.readBase64("compressed-frame.bin")
        let decoded = GrpcBodyDecoder.decode(rawBase64Text: b64, contentType: "application/grpc-web+proto", responseHeaders: [:])

        let frame = try #require(decoded.frames.first)
        #expect(frame.compressed == true)
        #expect(frame.payload == .compressedNotInflated)
    }

    @Test
    func truncatedFrameDecodesPartiallyWithoutCrashing() throws {
        let b64 = try GrpcFixtures.readBase64("truncated-frame.bin")
        let decoded = GrpcBodyDecoder.decode(rawBase64Text: b64, contentType: "application/grpc-web+proto", responseHeaders: [:])

        // The frame header declared 9 message bytes; only 3 were present.
        // Field 1 (2 bytes) parses fully; field 2 is cut off mid-tag and
        // must be dropped, not fabricated or crashed on.
        #expect(decoded.frames.count == 1)
        guard case .fields(let fields) = decoded.frames[0].payload else {
            Issue.record("expected a partial field tree")
            return
        }
        #expect(fields.count == 1)
        #expect(fields[0].value == .varint(42))
    }

    @Test
    func resolvesNonZeroStatusFromTheGrpcWebTrailerFrameOnHttp200() throws {
        let b64 = try GrpcFixtures.readBase64("grpc-web-status-not-found.bin")
        let decoded = GrpcBodyDecoder.decode(rawBase64Text: b64, contentType: "application/grpc-web+proto", responseHeaders: [:])

        let status = try #require(decoded.status)
        #expect(status.code == 5)
        #expect(status.known == .notFound)
        #expect(status.known?.name == "NOT_FOUND")
        #expect(status.message == "user not found")
        #expect(status.source == .grpcWebTrailerFrame)
        // Exactly one real message frame; the trailer frame is not counted
        // among the message frames.
        #expect(decoded.frames.count == 1)
    }

    @Test
    func resolvesOkStatusWithNoDataFrames() throws {
        let b64 = try GrpcFixtures.readBase64("grpc-web-status-ok.bin")
        let decoded = GrpcBodyDecoder.decode(rawBase64Text: b64, contentType: "application/grpc-web+proto", responseHeaders: [:])

        #expect(decoded.frames.isEmpty)
        let status = try #require(decoded.status)
        #expect(status.code == 0)
        #expect(status.known?.isOK == true)
    }

    @Test
    func plainGrpcWithoutATrailerFrameFallsBackToTrailersOnlyResponseHeader() throws {
        // Plain `application/grpc` never carries a trailer pseudo-frame in
        // the body (that is a gRPC-Web-only convention) — the only place a
        // status can come from is a "Trailers-Only" response header.
        let b64 = try GrpcFixtures.readBase64("unary-message.bin")
        let decoded = GrpcBodyDecoder.decode(
            rawBase64Text: b64,
            contentType: "application/grpc",
            responseHeaders: ["grpc-status": ["3"], "grpc-message": ["bad request"]]
        )

        let status = try #require(decoded.status)
        #expect(status.code == 3)
        #expect(status.known == .invalidArgument)
        #expect(status.message == "bad request")
        #expect(status.source == .trailersOnlyResponseHeader)
        #expect(decoded.isGrpcWeb == false)
    }

    @Test
    func plainGrpcWithNoTrailerAnywhereReportsNoStatusRatherThanGuessing() throws {
        let b64 = try GrpcFixtures.readBase64("unary-message.bin")
        let decoded = GrpcBodyDecoder.decode(rawBase64Text: b64, contentType: "application/grpc", responseHeaders: [:])

        #expect(decoded.status == nil)
        #expect(decoded.isGrpcWeb == false)
        // The frame itself still decodes — only the status is unresolved.
        #expect(decoded.frames.count == 1)
    }
}

@Suite("BodyViewerRegistry — gRPC content types route to .grpc")
struct GrpcViewerKindRoutingTests {
    @Test(arguments: [
        "application/grpc",
        "application/grpc+proto",
        "application/grpc-web",
        "application/grpc-web+proto",
        "application/grpc-web-text",
        "application/grpc-web+text",
        "application/grpc-web+json",
    ])
    func routesGrpcContentTypesToTheGrpcViewer(_ contentType: String) {
        let kind = BodyViewerRegistry.viewerKind(forContentType: contentType, body: "irrelevant")
        #expect(kind == .grpc)
    }

    @Test
    func leavesPlainProtobufOnTheHexViewer() {
        let kind = BodyViewerRegistry.viewerKind(forContentType: "application/x-protobuf", body: "irrelevant")
        #expect(kind == .hex)
    }
}
