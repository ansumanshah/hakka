import Foundation
import HakkaCommon

public enum RequestBodyEncodingError: Error, Equatable, Sendable {
    case invalidGraphQLVariables(String)
    case fileNotFound(String)
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
        case let .graphql(query, variables):
            try encodeGraphQL(query: query, variables: variables)
        case let .file(path, contentType):
            try encodeFile(path: path, contentType: contentType)
        }
    }

    private static func encodeForm(_ pairs: [HeaderPair]) -> EncodedBody {
        let text = pairs.map { "\(URLQuerySplitter.encode($0.name))=\(URLQuerySplitter.encode($0.value))" }.joined(separator: "&")
        return EncodedBody(data: Data(text.utf8), contentType: "application/x-www-form-urlencoded")
    }

    private static func encodeMultipart(_ parts: [MultipartPart]) throws(RequestBodyEncodingError) -> EncodedBody {
        let boundary = "hakka-\(UUID().uuidString)"
        var data = Data()
        for part in parts {
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
            if let filePath = part.filePath {
                guard let fileData = FileManager.default.contents(atPath: filePath) else {
                    throw .fileNotFound(filePath)
                }
                data.append(fileData)
            } else {
                data.append(Data(part.value.utf8))
            }
            data.append(Data("\r\n".utf8))
        }
        data.append(Data("--\(boundary)--\r\n".utf8))
        return EncodedBody(data: data, contentType: "multipart/form-data; boundary=\(boundary)")
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

    /// `variables` is JSON text; an empty template becomes `{}`, and text
    /// that fails to parse is refused rather than sent as a broken payload.
    private static func encodeGraphQL(query: String, variables: String) throws(RequestBodyEncodingError) -> EncodedBody {
        let trimmed = variables.trimmingCharacters(in: .whitespacesAndNewlines)
        let variablesObject: Any
        if trimmed.isEmpty {
            variablesObject = [String: Any]()
        } else if let data = trimmed.data(using: .utf8), let parsed = try? JSONSerialization.jsonObject(with: data) {
            variablesObject = parsed
        } else {
            throw .invalidGraphQLVariables(variables)
        }
        let payload: [String: Any] = ["query": query, "variables": variablesObject]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
            throw .invalidGraphQLVariables(variables)
        }
        return EncodedBody(data: data, contentType: "application/json")
    }

    private static func encodeFile(path: String, contentType: String) throws(RequestBodyEncodingError) -> EncodedBody {
        guard let data = FileManager.default.contents(atPath: path) else {
            throw .fileNotFound(path)
        }
        return EncodedBody(data: data, contentType: contentType)
    }
}
