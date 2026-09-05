// @generated — do not edit. Synced from ios/Sources/Common/BodyDecoders/SseDecoder.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// A single parsed Server-Sent Event record. Port of `decoders.ts`'s `SseEvent`.
public struct SseEvent: Equatable {
    /// The `event:` field value, if present.
    public var event: String?
    /// The `data:` field value(s), joined with '\n' per the EventSource spec.
    public var data: String
    /// The `id:` field value, if present.
    public var id: String?
    /// The `retry:` field value (reconnection time in ms), if present and numeric.
    public var retry: Int?

    public init(event: String? = nil, data: String, id: String? = nil, retry: Int? = nil) {
        self.event = event
        self.data = data
        self.id = id
        self.retry = retry
    }
}

/// Parse a raw `text/event-stream` body into a list of SSE events, following
/// the WHATWG EventSource framing. Never throws — malformed input degrades to
/// best-effort parsing. Line-for-line port of `decoders.ts`'s `decodeSse`.
public func decodeSse(_ body: String) -> [SseEvent] {
    var events: [SseEvent] = []
    guard !body.isEmpty else { return events }

    let normalized = body.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    let lines = normalized.components(separatedBy: "\n")

    var curEvent: String?
    var curData: [String] = []
    var curId: String?
    var curRetry: Int?
    var sawAnyField = false

    func flush() {
        if sawAnyField {
            events.append(SseEvent(event: curEvent, data: curData.joined(separator: "\n"), id: curId, retry: curRetry))
        }
        curEvent = nil
        curData = []
        curId = nil
        curRetry = nil
        sawAnyField = false
    }

    for rawLine in lines {
        if rawLine.isEmpty {
            flush()
            continue
        }
        if rawLine.hasPrefix(":") {
            continue
        }

        let field: Substring
        var value: Substring
        if let colonIdx = rawLine.firstIndex(of: ":") {
            field = rawLine[rawLine.startIndex..<colonIdx]
            value = rawLine[rawLine.index(after: colonIdx)...]
            if value.hasPrefix(" ") {
                value = value.dropFirst()
            }
        } else {
            field = rawLine[...]
            value = ""
        }

        switch field {
        case "event":
            curEvent = String(value)
            sawAnyField = true
        case "data":
            curData.append(String(value))
            sawAnyField = true
        case "id":
            curId = String(value)
            sawAnyField = true
        case "retry":
            if !value.isEmpty, value.allSatisfy({ $0.isASCII && $0.isNumber }), let n = Int(value) {
                curRetry = n
                sawAnyField = true
            }
        default:
            break
        }
    }

    flush()
    return events
}

private let sseContentType = "text/event-stream"

/// Registry decoder for `text/event-stream` bodies — parses SSE and renders it
/// as a JSON event array. Port of `decoders.ts`'s `sseDecoder`.
struct SseBodyDecoder: HakkaBodyDecoder {
    let id = "sse"

    func decode(_ body: String, contentType: String?, contentEncoding: String?) -> String? {
        guard let ct = hakkaNormalizedMimeType(contentType), ct == sseContentType else { return nil }
        return formatSseEventsAsJson(decodeSse(body))
    }
}

/// Renders SSE events as JSON matching `JSON.stringify(events, null, 2)`
/// exactly: 2-space indent, `data` first then `event`/`id`/`retry` only when
/// present (insertion order, not alphabetical). Hand-rolled rather than
/// `JSONEncoder` because `JSONEncoder` on this Foundation does not preserve
/// keyed-container encode-call order — it silently reorders keys — so it
/// cannot be trusted to match JS object insertion order.
private func formatSseEventsAsJson(_ events: [SseEvent]) -> String {
    guard !events.isEmpty else { return "[]" }
    let objects = events.map { event -> String in
        var fields = ["    \"data\": \(jsonStringLiteral(event.data))"]
        if let e = event.event { fields.append("    \"event\": \(jsonStringLiteral(e))") }
        if let id = event.id { fields.append("    \"id\": \(jsonStringLiteral(id))") }
        if let retry = event.retry { fields.append("    \"retry\": \(retry)") }
        return "  {\n" + fields.joined(separator: ",\n") + "\n  }"
    }
    return "[\n" + objects.joined(separator: ",\n") + "\n]"
}

/// Quotes and escapes a string like `JSON.stringify`: wraps in double quotes,
/// escapes `"`/`\`/control characters (`\n`/`\r`/`\t` as named escapes, other
/// control chars as `\u00XX`), leaves non-ASCII UTF-8 and `/` unescaped.
private func jsonStringLiteral(_ s: String) -> String {
    var out = "\""
    for scalar in s.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if scalar.value < 0x20 {
                out += String(format: "\\u%04x", scalar.value)
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
    }
    out += "\""
    return out
}
