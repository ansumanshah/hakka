import Foundation
import HakkaCommon

/// Status-based and body/header-disagreement rules for `RequestDiagnoser`.
/// Split from `RequestDiagnosis.swift` to keep files under the 200-line cap;
/// transport-failure and redirect-chain rules live there.
extension RequestDiagnoser {
    // MARK: - Status-based diagnoses (a response was received)

    static func statusDiagnosis(status: Int, record: NetworkRequest) -> RequestDiagnosis? {
        switch status {
        case 401: return unauthorized(record)
        case 304: return notModified(record)
        case 413: return payloadTooLarge(record)
        case 429: return rateLimited(record)
        default: return nil
        }
    }

    /// A missing `Authorization` header and a rejected credential are
    /// different bugs, so they get different sentences — the evidence for
    /// each is simply whether the header was sent.
    private static func unauthorized(_ record: NetworkRequest) -> RequestDiagnosis {
        if let auth = record.requestHeaderValue("Authorization"), !auth.isEmpty {
            return RequestDiagnosis(
                text: "401 with an Authorization header present: the credential was sent and rejected.",
                severity: .error,
                systemImage: "key.slash"
            )
        }
        return RequestDiagnosis(
            text: "401 with no Authorization header on the request: the credential was never sent.",
            severity: .error,
            systemImage: "key.slash"
        )
    }

    /// A 304 only happens when the server matched a conditional validator
    /// the client sent, so naming the header the request carried is a
    /// readback of the request, not a guess about server behavior.
    private static func notModified(_ record: NetworkRequest) -> RequestDiagnosis? {
        let validator: String
        if let etag = record.requestHeaderValue("If-None-Match"), !etag.isEmpty {
            validator = "If-None-Match"
        } else if let modified = record.requestHeaderValue("If-Modified-Since"), !modified.isEmpty {
            validator = "If-Modified-Since"
        } else {
            return nil
        }
        return RequestDiagnosis(
            text: "304 Not Modified: served from cache, matched by \(validator).",
            severity: .info,
            systemImage: "checkmark.icloud"
        )
    }

    private static func payloadTooLarge(_ record: NetworkRequest) -> RequestDiagnosis? {
        guard record.requestBodySize > 0 else { return nil }
        return RequestDiagnosis(
            text: "413 Payload Too Large: the request body was \(byteString(record.requestBodySize)).",
            severity: .error,
            systemImage: "shippingbox"
        )
    }

    private static func rateLimited(_ record: NetworkRequest) -> RequestDiagnosis? {
        guard let retryAfter = record.responseHeaderValue("Retry-After"), !retryAfter.isEmpty else { return nil }
        return RequestDiagnosis(
            text: "429 Too Many Requests: server asked to retry after \(retryAfter).",
            severity: .warning,
            systemImage: "hourglass"
        )
    }

    // MARK: - Body/header disagreement (independent of status)

    /// A declared `Content-Type` of JSON whose body does not parse as JSON.
    /// Requires a non-empty response body to check, so an empty body (204,
    /// HEAD, etc.) makes no claim.
    static func contentTypeMismatch(_ record: NetworkRequest) -> RequestDiagnosis? {
        guard let contentType = record.contentType?.lowercased(), contentType.contains("json") else { return nil }
        guard let body = record.responseBody, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        guard let data = body.data(using: .utf8),
              (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) == nil
        else { return nil }
        return RequestDiagnosis(
            text: "Content-Type declared JSON, but the response body did not parse as JSON.",
            severity: .warning,
            systemImage: "exclamationmark.arrow.triangle.2.circlepath"
        )
    }

    private static func byteString(_ count: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: count, countStyle: .memory)
    }
}
