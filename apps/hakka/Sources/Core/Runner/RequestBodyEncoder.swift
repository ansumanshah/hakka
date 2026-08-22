import Foundation
import HakkaCommon

public enum RequestBodyEncodingError: Error, Equatable, Sendable {
    case invalidGraphQLVariables(String)
    case fileNotFound(String)
    /// Every generated boundary candidate collided with part content.
    /// Astronomically unlikely with a UUID-based generator — this exists so
    /// a pathological or adversarial candidate source fails loudly instead
    /// of silently shipping a corrupt multipart body.
    case boundaryGenerationFailed
    /// A `.grpcMessage` editor value that is neither valid hex nor valid
    /// base64 — see `GrpcMessageBytesCodec`.
    case invalidGrpcMessageEncoding(String)
}

struct EncodedBody: Sendable, Equatable {
    let data: Data?
    let contentType: String?
}

/// Turns an already-interpolated `BodySpec` into the bytes that go on the
/// wire. Kept separate from `RequestResolver` because encoding does I/O
/// (file reads) that resolution — a pure, synchronous step — deliberately
/// does not.
enum RequestBodyEncoder {
    static func encode(_ body: BodySpec) throws(RequestBodyEncodingError) -> EncodedBody {
        switch body {
        case .none:
            EncodedBody(data: nil, contentType: nil)
        case let .raw(text, contentType):
            EncodedBody(data: Data(text.utf8), contentType: contentType)
        case let .form(pairs):
            encodeForm(pairs)
        case let .multipart(parts):
            try encodeMultipart(parts)
        case let .graphql(query, variables, operationName):
            try encodeGraphQL(query: query, variables: variables, operationName: operationName)
        case let .file(path, contentType):
            try encodeFile(path: path, contentType: contentType)
        case let .grpcMessage(hex):
            try encodeGrpcMessage(hex)
        }
    }

    // MARK: - gRPC message (ADR 0012)

    /// Decodes the editor's hex-or-base64 text into the raw, unframed
    /// message bytes `GrpcRunner` hands to `GrpcTransport` — gRPC's own
    /// length-prefixed wire framing is added later, by `GrpcWireFraming`,
    /// only for the synthetic display record, not here. An empty field
    /// decodes to zero bytes (a legitimate empty message, e.g.
    /// `google.protobuf.Empty`), not an error.
    private static func encodeGrpcMessage(_ hex: String) throws(RequestBodyEncodingError) -> EncodedBody {
        guard let data = GrpcMessageBytesCodec.decode(hex) else {
            throw .invalidGrpcMessageEncoding(hex)
        }
        return EncodedBody(data: data, contentType: "application/grpc")
    }

    private static func encodeForm(_ pairs: [HeaderPair]) -> EncodedBody {
        let text = pairs.map { "\(URLQuerySplitter.encode($0.name))=\(URLQuerySplitter.encode($0.value))" }.joined(separator: "&")
        return EncodedBody(data: Data(text.utf8), contentType: "application/x-www-form-urlencoded")
    }

    // MARK: - Multipart

    private static func encodeMultipart(_ parts: [MultipartPart]) throws(RequestBodyEncodingError) -> EncodedBody {
        var resolved: [(MultipartPart, Data)] = []
        for part in parts {
            if let filePath = part.filePath {
                guard let fileData = FileManager.default.contents(atPath: filePath) else {
                    throw .fileNotFound(filePath)
                }
                resolved.append((part, fileData))
            } else {
                resolved.append((part, Data(part.value.utf8)))
            }
        }
        let boundary = try chooseBoundary(avoiding: resolved.map(\.1))

        var data = Data()
        for (part, content) in resolved {
            data.append(Data("--\(boundary)\r\n".utf8))
            var disposition = "Content-Disposition: form-data; name=\"\(dispositionEscaped(part.name))\""
            if let filePath = part.filePath {
                let filename = (filePath as NSString).lastPathComponent
                disposition += "; filename=\"\(dispositionEscaped(filename))\""
            }
            data.append(Data("\(disposition)\r\n".utf8))
            if let contentType = part.contentType {
                data.append(Data("Content-Type: \(contentType)\r\n".utf8))
            }
            data.append(Data("\r\n".utf8))
            data.append(content)
            data.append(Data("\r\n".utf8))
        }
        data.append(Data("--\(boundary)--\r\n".utf8))
        return EncodedBody(data: data, contentType: "multipart/form-data; boundary=\(boundary)")
    }

    /// Picks a boundary that cannot appear inside any part's own content —
    /// if it did, a part whose bytes happened to contain `--<boundary>` would
    /// be indistinguishable from a real delimiter and the body would decode
    /// wrong on the receiving end. A UUID-based candidate colliding with real
    /// content is vanishingly unlikely, but "vanishingly unlikely" isn't a
    /// correctness guarantee, so this actually checks and retries rather than
    /// trusting the odds. `candidates` and `maxAttempts` are internal (not
    /// private) so tests can inject a rigged sequence.
    static func chooseBoundary(
        avoiding contents: [Data],
        candidates: () -> String = { "hakka-\(UUID().uuidString)" },
        maxAttempts: Int = 25,
    ) throws(RequestBodyEncodingError) -> String {
        for _ in 0..<maxAttempts {
            let candidate = candidates()
            if !boundaryCollides(candidate, in: contents) { return candidate }
        }
        throw .boundaryGenerationFailed
    }

    /// True if `boundary` occurs anywhere inside any of `contents` — checked
    /// as raw bytes, not text, so it also catches a collision inside a binary
    /// file part where UTF-8 decoding wouldn't apply.
    static func boundaryCollides(_ boundary: String, in contents: [Data]) -> Bool {
        let needle = Data(boundary.utf8)
        return contents.contains { $0.range(of: needle) != nil }
    }

    /// Makes a value safe to sit inside a `Content-Disposition` quoted-string.
    /// `name`/`filePath` reach here after `{{variable}}` interpolation, so a
    /// captured value (from a prior response) could otherwise smuggle a `"` to
    /// break out of the quoted string, or a CR/LF to inject a header line or a
    /// forged boundary marker into the multipart body. Backslash-escape first
    /// so an escaped quote isn't later "un-escaped" by the quote pass, then
    /// strip CR/LF entirely — there's no legitimate use for a literal newline
    /// in a form field name or filename.
    private static func dispositionEscaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
    }

    // MARK: - GraphQL

    /// `variables` is JSON text; an empty template becomes `{}`, and text
    /// that fails to parse is refused rather than sent as a broken payload.
    /// `operationName` is only written when the query selected one — GraphQL
    /// servers treat a present-but-null `operationName` the same as an
    /// absent one for a single-operation document, but an absent key is the
    /// less surprising thing to send.
    private static func encodeGraphQL(
        query: String,
        variables: String,
        operationName: String?,
    ) throws(RequestBodyEncodingError) -> EncodedBody {
        let trimmed = variables.trimmingCharacters(in: .whitespacesAndNewlines)
        let variablesObject: Any
        if trimmed.isEmpty {
            variablesObject = [String: Any]()
        } else if let data = trimmed.data(using: .utf8), let parsed = try? JSONSerialization.jsonObject(with: data) {
            variablesObject = parsed
        } else {
            throw .invalidGraphQLVariables(variables)
        }
        var payload: [String: Any] = ["query": query, "variables": variablesObject]
        if let operationName, !operationName.isEmpty {
            payload["operationName"] = operationName
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
            throw .invalidGraphQLVariables(variables)
        }
        return EncodedBody(data: data, contentType: "application/json")
    }

    // MARK: - File

    private static func encodeFile(path: String, contentType: String) throws(RequestBodyEncodingError) -> EncodedBody {
        guard let data = FileManager.default.contents(atPath: path) else {
            throw .fileNotFound(path)
        }
        return EncodedBody(data: data, contentType: contentType)
    }
}
