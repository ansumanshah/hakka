import Foundation
import HakkaCommon

/// Parses `text/event-stream` bodies into event records on top of HakkaCommon's
/// shared SSE framing, so the desktop presenter splits bodies exactly like the
/// other surfaces, and answers the content-type question that gates
/// event-stream UI.
public enum SseEventParser {
    /// The raw body split into events; an absent body parses to none.
    public static func parse(_ body: String?) -> [SseEvent] {
        guard let body else { return [] }
        return decodeSse(body)
    }

    /// True when a response content type names an event stream, parameters
    /// and case aside (`text/event-stream; charset=utf-8` included).
    public static func isEventStream(contentType: String?) -> Bool {
        guard let value = contentType?.lowercased() else { return false }
        let mimeType = value.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false)[0]
        return mimeType.trimmingCharacters(in: .whitespaces) == "text/event-stream"
    }
}
