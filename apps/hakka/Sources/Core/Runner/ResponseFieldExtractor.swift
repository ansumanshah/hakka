import Foundation
import HakkaCommon

/// Reads one field of a response — status, duration, a header, a JSON path,
/// or the raw body — as a string. `Assertion.target` and `ResponseCapture
/// .source` are both `AssertionTarget`, so this one implementation backs
/// both assertion evaluation and capture extraction.
enum ResponseFieldExtractor {
    static func value(for target: AssertionTarget, in record: NetworkRequest) -> String? {
        switch target {
        case .status: record.status.map(String.init)
        case .durationMs: record.duration.map(String.init)
        case let .header(name): record.responseHeaderValue(name)
        case let .jsonPath(path): jsonValue(path: path, body: record.responseBody)
        case .bodyText: record.responseBody
        }
    }

    private static func jsonValue(path: String, body: String?) -> String? {
        guard let body, let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data)
        else { return nil }
        return JSONPathEvaluator.stringify(JSONPathEvaluator.value(at: path, in: json))
    }
}
