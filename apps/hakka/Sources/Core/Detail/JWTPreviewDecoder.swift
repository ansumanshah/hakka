import Foundation

/// Decodes the displayable parts of a compact JWT entirely on-device. This
/// intentionally does not validate a signature or contact an issuer.
public enum JWTPreviewDecoder {
    public struct Limits: Sendable {
        public let maximumEncodedSegmentLength: Int
        public let maximumDecodedSegmentLength: Int

        public init(maximumEncodedSegmentLength: Int = 16384, maximumDecodedSegmentLength: Int = 8192) {
            self.maximumEncodedSegmentLength = max(1, maximumEncodedSegmentLength)
            self.maximumDecodedSegmentLength = max(1, maximumDecodedSegmentLength)
        }
    }

    public struct Preview: Equatable, Sendable {
        public let header: String
        public let payload: String
    }

    public enum DecodeError: Error, Equatable, LocalizedError, Sendable {
        case invalidToken
        case segmentTooLarge(String)
        case invalidEncoding(String)
        case invalidUTF8(String)
        case invalidJSON(String)

        public var errorDescription: String? {
            switch self {
            case .invalidToken: "Enter a compact JWT with three segments."
            case let .segmentTooLarge(name): "The JWT \(name) is too large to preview."
            case let .invalidEncoding(name): "The JWT \(name) is not valid base64url."
            case let .invalidUTF8(name): "The JWT \(name) is not valid UTF-8."
            case let .invalidJSON(name): "The JWT \(name) is not a JSON object."
            }
        }
    }

    /// Returns a whole-text JWT candidate for a body-viewer prefill. This is
    /// intentionally a shape check; decoding still performs strict validation.
    public static func plausibleToken(from text: String, limits: Limits = Limits()) -> String? {
        let token = normalizedToken(text)
        let segments = token.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3,
              !segments[0].isEmpty,
              !segments[1].isEmpty,
              !segments[2].isEmpty,
              segments.allSatisfy({ $0.utf8.count <= limits.maximumEncodedSegmentLength }),
              segments.allSatisfy(isBase64URL)
        else { return nil }
        return token
    }

    /// Decodes and pretty-prints the JSON header and payload. The signature is
    /// deliberately not parsed or verified.
    public static func decode(_ input: String, limits: Limits = Limits()) throws -> Preview {
        let token = normalizedToken(input)
        let segments = token.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3,
              !segments[0].isEmpty,
              !segments[1].isEmpty,
              !segments[2].isEmpty
        else {
            throw DecodeError.invalidToken
        }
        for (index, segment) in segments.enumerated() {
            let name = ["header", "payload", "signature"][index]
            guard segment.utf8.count <= limits.maximumEncodedSegmentLength else {
                throw DecodeError.segmentTooLarge(name)
            }
            guard isBase64URL(segment) else {
                throw DecodeError.invalidEncoding(name)
            }
        }

        let header = try decodeObject(segment: String(segments[0]), name: "header", limits: limits)
        let payload = try decodeObject(segment: String(segments[1]), name: "payload", limits: limits)
        return Preview(header: header, payload: payload)
    }

    private static func normalizedToken(_ input: String) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 7, trimmed.prefix(7).lowercased() == "bearer " else { return trimmed }
        return String(trimmed.dropFirst(7)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func decodeObject(segment: String, name: String, limits: Limits) throws -> String {
        guard segment.utf8.count <= limits.maximumEncodedSegmentLength else {
            throw DecodeError.segmentTooLarge(name)
        }
        guard isBase64URL(Substring(segment)), segment.count % 4 != 1 else {
            throw DecodeError.invalidEncoding(name)
        }

        var base64 = segment.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64.append(String(repeating: "=", count: (4 - base64.count % 4) % 4))
        guard let data = Data(base64Encoded: base64) else {
            throw DecodeError.invalidEncoding(name)
        }
        guard data.count <= limits.maximumDecodedSegmentLength else {
            throw DecodeError.segmentTooLarge(name)
        }
        guard String(data: data, encoding: .utf8) != nil else {
            throw DecodeError.invalidUTF8(name)
        }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              object is [String: Any],
              let prettyData = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
              let pretty = String(data: prettyData, encoding: .utf8)
        else {
            throw DecodeError.invalidJSON(name)
        }
        return pretty
    }

    private static func isBase64URL(_ segment: Substring) -> Bool {
        segment.allSatisfy { character in
            character.isASCII && (character.isLetter || character.isNumber || character == "-" || character == "_")
        }
    }
}
