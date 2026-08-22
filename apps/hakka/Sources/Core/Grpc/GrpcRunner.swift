import Foundation
import HakkaCommon

/// Resolve, send, decode — the gRPC counterpart of `RequestRunner`, and a
/// sibling actor rather than a branch inside it (ADR 0010 sub-decision 4:
/// "new send paths are transports"; ADR 0012 extends that to gRPC).
///
/// `resolvePlan`/`encodeBody` reuse `RequestResolver`/`RequestBodyEncoder`
/// completely unmodified — gRPC needed no resolution logic of its own, only
/// one new `BodySpec` case. The only gRPC-specific step is the final one:
/// instead of a `URLRequest` over `RequestTransport`, this builds a
/// `GrpcUnaryRequest` over `GrpcTransport`, then folds the result back into
/// the same `NetworkRequest`/`RunResult` shape `RequestRunner` produces, so
/// every downstream consumer (the detail pane, `GrpcBodyDecode`, HAR/OTel
/// export) needs zero gRPC-specific code.
///
/// Phase 1 runs no assertions, captures, or scripts against a gRPC send —
/// see ADR 0012's consequences. `folderChain`/`collection`/`scope` still
/// flow through so header/auth inheritance and `{{variable}}` resolution
/// work exactly like an HTTP request in the same collection.
public actor GrpcRunner {
    private let transport: GrpcTransport

    public init(transport: GrpcTransport = GRPCSwiftUnaryTransport()) {
        self.transport = transport
    }

    public func run(
        _ request: RequestSpec,
        folderChain: [Folder] = [],
        collection: Collection,
        scope: VariableScope,
    ) async throws(RequestRunnerError) -> RunResult {
        let resolved = try resolvePlan(request, folderChain: folderChain, collection: collection, scope: scope)
        guard let target = GrpcTarget(url: resolved.url) else {
            throw .resolution(.invalidURL(resolved.url.absoluteString))
        }
        let encodedBody = try encodeBody(resolved.body)
        let messageBytes = encodedBody.data ?? Data()

        // `resolved.headers` carries a synthesized "Content-Type:
        // application/grpc" from `BodySpec.grpcMessage.contentTypeHeader` —
        // useful for the display record below, meaningless (and reserved)
        // as gRPC metadata, so it's excluded from what actually goes out
        // over the wire.
        let metadata = resolved.headers
            .filter { $0.key.caseInsensitiveCompare("content-type") != .orderedSame }
            .map { GrpcMetadataEntry(name: $0.key, value: $0.value) }

        let startedAt = Date()
        let grpcRequest = GrpcUnaryRequest(target: target, metadata: metadata, message: messageBytes, timeout: resolved.timeout)
        let record = await sendAndBuildRecord(
            grpcRequest,
            requestHeaders: resolved.headers,
            messageBytes: messageBytes,
            url: resolved.url,
            startedAt: startedAt,
        )

        return RunResult(record: record, assertionResults: [], scope: scope, scriptError: nil)
    }

    private func resolvePlan(
        _ request: RequestSpec,
        folderChain: [Folder],
        collection: Collection,
        scope: VariableScope,
    ) throws(RequestRunnerError) -> ResolvedRequest {
        do {
            return try RequestResolver.resolve(request, folderChain: folderChain, collection: collection, scope: scope)
        } catch {
            throw .resolution(error)
        }
    }

    private func encodeBody(_ body: BodySpec) throws(RequestRunnerError) -> EncodedBody {
        do {
            return try RequestBodyEncoder.encode(body)
        } catch {
            throw .bodyEncoding(error)
        }
    }

    private func sendAndBuildRecord(
        _ grpcRequest: GrpcUnaryRequest,
        requestHeaders: [String: String],
        messageBytes: Data,
        url: URL,
        startedAt: Date,
    ) async -> NetworkRequest {
        let startTime = Int64(startedAt.timeIntervalSince1970 * 1000)
        let requestFrame = GrpcWireFraming.encodeFrame(messageBytes)

        do {
            let response = try await transport.unary(grpcRequest)
            let responseHeaders = Self.buildResponseHeaders(response)
            let responseFrame = response.message.map { GrpcWireFraming.encodeFrame($0) }

            return NetworkRequest(
                url: url.absoluteString,
                method: .post,
                // gRPC's real outcome is the grpc-status trailer folded into
                // `responseHeaders` below, not this field — see
                // `GrpcBodyView`. 200 only when a response genuinely arrived
                // (statusCode == .ok); left unset otherwise rather than
                // guessing whether the failure was transport- or RPC-level.
                status: response.statusCode == GrpcStatusCode.ok.rawValue ? 200 : nil,
                startTime: startTime,
                duration: elapsedMs(since: startedAt),
                requestHeaders: requestHeaders.mapValues { [$0] },
                responseHeaders: responseHeaders,
                requestBodySize: Int64(messageBytes.count),
                responseBodySize: Int64(response.message?.count ?? 0),
                requestBody: requestFrame.base64EncodedString(),
                responseBody: responseFrame?.base64EncodedString(),
                source: .grpcClient,
            )
        } catch {
            // Only a pre-flight failure (target/transport couldn't even be
            // constructed) reaches here — `GrpcTransport.unary` never
            // throws for a connection or RPC failure once the attempt
            // starts (see its doc comment), so this mirrors
            // `RequestRunner+Send`'s "transport failure is a record.error,
            // not a crash" rule for the one case that's genuinely a crash
            // otherwise.
            return NetworkRequest(
                url: url.absoluteString,
                method: .post,
                startTime: startTime,
                duration: elapsedMs(since: startedAt),
                requestHeaders: requestHeaders.mapValues { [$0] },
                requestBodySize: Int64(messageBytes.count),
                requestBody: requestFrame.base64EncodedString(),
                error: String(describing: error),
                source: .grpcClient,
            )
        }
    }

    /// Initial metadata as `responseHeaders`, trailing metadata folded in
    /// beside it (so both are visible in the existing headers viewer — ADR
    /// 0012's "metadata visible" requirement), with `grpc-status`/
    /// `grpc-message` guaranteed present. Folding trailers into
    /// `responseHeaders` is exactly the shape `GrpcBodyDecode.resolveStatus`
    /// already reads via its `.trailersOnlyResponseHeader` fallback — this
    /// send path has real trailers to put there, unlike passive capture.
    private static func buildResponseHeaders(_ response: GrpcUnaryResponse) -> [String: [String]] {
        // `GRPCCore`'s `Metadata` never carries the raw HTTP `content-type`
        // (it's a framing-layer concern the library abstracts away), but
        // this response *is* gRPC-framed regardless of what the transport
        // reported — `record.contentType` (and so `GrpcBodyDecode`'s viewer
        // routing) needs it set explicitly, the same way the request side
        // gets it from `BodySpec.grpcMessage.contentTypeHeader`.
        var headers: [String: [String]] = ["content-type": ["application/grpc"]]
        for entry in response.initialMetadata {
            headers[entry.name, default: []].append(entry.value)
        }
        for entry in response.trailingMetadata {
            headers[entry.name, default: []].append(entry.value)
        }
        if headers["grpc-status"] == nil {
            headers["grpc-status"] = [String(response.statusCode)]
        }
        if let statusMessage = response.statusMessage, headers["grpc-message"] == nil {
            headers["grpc-message"] = [statusMessage]
        }
        return headers
    }

    private func elapsedMs(since startedAt: Date) -> Int64 {
        Int64(Date().timeIntervalSince(startedAt) * 1000)
    }
}
