// @generated — do not edit. Synced from ios/Sources/Common/BodyDecoders/WsFrameDecoders+Stomp.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

private let stompCommands: Set<String> = [
    "CONNECT", "STOMP", "CONNECTED", "SEND", "SUBSCRIBE", "UNSUBSCRIBE",
    "ACK", "NACK", "BEGIN", "COMMIT", "ABORT", "DISCONNECT", "RECEIPT", "ERROR", "MESSAGE",
]

/// STOMP frame decoder (`v10.stomp`, `v11.stomp`, `v12.stomp`). Parses the
/// command line, `key: value` headers up to the blank line, and the body up
/// to the NUL frame terminator. Port of `wsDecoders.ts`'s `stompDecoder`.
struct StompWsFrameDecoder: HakkaWsFrameDecoder {
    let id = "stomp"
    let protocols: [String]? = ["v10.stomp", "v11.stomp", "v12.stomp"]

    func decode(_ payload: WsPayload, binary: Bool, wsProtocol: String?) -> WsFrameInfo? {
        guard !binary, case .text(let text) = payload, !text.isEmpty else { return nil }

        let newlineIdx = text.firstIndex(of: "\n")
        let commandLine = newlineIdx.map { String(text[text.startIndex..<$0]) } ?? text
        let command = stripTrailingCR(commandLine)
        guard stompCommands.contains(command) else { return nil }

        var cursor = newlineIdx.map { text.index(after: $0) } ?? text.startIndex
        let headers = parseHeaders(text, cursor: &cursor)
        let destination = headers["destination"]

        let nullIdx = text[cursor...].firstIndex(of: "\0") ?? text.endIndex
        let body = String(text[cursor..<nullIdx])
        let payloadPreview: String?
        if body.count > 120 {
            payloadPreview = String(body.prefix(120)) + "…"
        } else {
            payloadPreview = body.isEmpty ? nil : body
        }

        var summaryParts = [command]
        if let destination { summaryParts.append(destination) }

        return WsFrameInfo(
            kind: "stomp",
            summary: summaryParts.joined(separator: " "),
            topic: destination,
            payloadPreview: payloadPreview
        )
    }
}

private func stripTrailingCR(_ line: String) -> String {
    line.hasSuffix("\r") ? String(line.dropLast()) : line
}

/// Scans `key: value` header lines starting at `cursor` until a blank line,
/// advancing `cursor` past it (to the start of the body). Later duplicate
/// keys overwrite earlier ones, matching plain-object assignment in the
/// TS oracle.
private func parseHeaders(_ text: String, cursor: inout String.Index) -> [String: String] {
    var headers: [String: String] = [:]
    while cursor < text.endIndex {
        let lineEnd = text[cursor...].firstIndex(of: "\n") ?? text.endIndex
        let line = stripTrailingCR(String(text[cursor..<lineEnd]))
        if line.isEmpty {
            cursor = lineEnd < text.endIndex ? text.index(after: lineEnd) : text.endIndex
            break
        }
        if let colonIdx = line.firstIndex(of: ":") {
            let key = line[line.startIndex..<colonIdx].trimmingCharacters(in: .whitespaces)
            let value = line[line.index(after: colonIdx)...].trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }
        cursor = lineEnd < text.endIndex ? text.index(after: lineEnd) : text.endIndex
    }
    return headers
}
