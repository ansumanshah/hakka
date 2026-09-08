import Foundation
import HakkaCommon

/// Executes finite authored WebSocket and SSE exchanges. The live inspector
/// continues using its capture session when a request has no `session`.
actor RequestSessionRunner {
    private static let maxBodyBytes = 5 * 1024 * 1024

    func run(_ resolved: ResolvedRequest, session spec: RequestSessionSpec) async -> NetworkRequest {
        let startedAt = Date()
        do {
            let record: NetworkRequest
            switch spec {
            case let .webSocket(webSocket):
                record = try await withTimeout(milliseconds: webSocket.timeoutMs) { [self] in
                    try await runWebSocket(resolved, spec: webSocket, startedAt: startedAt)
                }
            case let .sse(sse):
                record = try await withTimeout(milliseconds: sse.timeoutMs) { [self] in
                    try await runSSE(resolved, spec: sse, startedAt: startedAt)
                }
            }
            return record
        } catch {
            return NetworkRequest(
                url: resolved.url.absoluteString,
                method: resolved.method,
                startTime: Int64(startedAt.timeIntervalSince1970 * 1000),
                duration: elapsed(since: startedAt),
                requestHeaders: resolved.headers.mapValues { [$0] },
                error: String(describing: error),
                source: .urlSession,
            )
        }
    }

    private func runWebSocket(
        _ resolved: ResolvedRequest,
        spec: WebSocketSessionSpec,
        startedAt: Date,
    ) async throws -> NetworkRequest {
        try validate(maximum: spec.maxFrames, timeoutMs: spec.timeoutMs, label: "WebSocket")
        guard spec.sendFrames.count <= 10_000 else { throw RequestSessionError.invalidLimits("WebSocket") }
        guard resolved.url.scheme?.lowercased() == "ws" || resolved.url.scheme?.lowercased() == "wss" else {
            throw RequestSessionError.invalidURL("WebSocket sessions require ws:// or wss://")
        }
        var sentByteCount = 0
        var messages: [URLSessionWebSocketTask.Message] = []
        for frame in spec.sendFrames {
            if frame.isBinary {
                guard let data = Data(base64Encoded: frame.data) else { throw RequestSessionError.invalidFrame }
                sentByteCount += data.count
                guard sentByteCount <= Self.maxBodyBytes else { throw RequestSessionError.bodyTooLarge }
                messages.append(.data(data))
            } else {
                sentByteCount += frame.data.utf8.count
                guard sentByteCount <= Self.maxBodyBytes else { throw RequestSessionError.bodyTooLarge }
                messages.append(.string(frame.data))
            }
        }
        var mutableRequest = URLRequest(url: resolved.url)
        mutableRequest.allHTTPHeaderFields = resolved.headers
        let request = mutableRequest
        let urlSession = URLSession(configuration: .ephemeral)
        let task = urlSession.webSocketTask(with: request)
        task.maximumMessageSize = Self.maxBodyBytes
        return try await withTaskCancellationHandler {
            task.resume()
            defer {
                task.cancel(with: .normalClosure, reason: nil)
                urlSession.invalidateAndCancel()
            }
            for message in messages { try await task.send(message) }
            var frames: [[String: Any]] = []
            var byteCount = 0
            while frames.count < spec.maxFrames {
                let message = try await task.receive()
                switch message {
                case let .string(text):
                    byteCount += text.utf8.count
                    guard byteCount <= Self.maxBodyBytes else { throw RequestSessionError.bodyTooLarge }
                    frames.append(["data": text, "isBinary": false])
                case let .data(data):
                    byteCount += data.count
                    guard byteCount <= Self.maxBodyBytes else { throw RequestSessionError.bodyTooLarge }
                    frames.append(["data": data.base64EncodedString(), "isBinary": true])
                @unknown default: break
                }
            }
            return record(
                resolved,
                startedAt: startedAt,
                status: 101,
                headers: [:],
                body: try JSONSerialization.data(withJSONObject: ["frames": frames]),
            )
        } onCancel: {
            task.cancel(with: .goingAway, reason: nil)
            urlSession.invalidateAndCancel()
        }
    }

    private func runSSE(
        _ resolved: ResolvedRequest,
        spec: SSESessionSpec,
        startedAt: Date,
    ) async throws -> NetworkRequest {
        try validate(maximum: spec.maxEvents, timeoutMs: spec.timeoutMs, label: "SSE")
        guard resolved.url.scheme?.lowercased() == "http" || resolved.url.scheme?.lowercased() == "https" else {
            throw RequestSessionError.invalidURL("SSE sessions require http:// or https://")
        }
        var mutableRequest = URLRequest(url: resolved.url)
        mutableRequest.allHTTPHeaderFields = resolved.headers
        let request = mutableRequest
        let urlSession = URLSession(configuration: .ephemeral)
        return try await withTaskCancellationHandler {
            defer { urlSession.invalidateAndCancel() }
            let (bytes, response) = try await urlSession.bytes(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  http.value(forHTTPHeaderField: "Content-Type")?
                  .split(separator: ";", maxSplits: 1).first?
                  .trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "text/event-stream"
            else { throw RequestSessionError.invalidResponse("Expected an SSE response") }

            var events: [[String: String]] = []
            var dataLines: [String] = []
            var eventType = ""
            var lastEventID: String?
            var line = Data()
            var byteCount = 0
            var skipLineFeed = false

            func consumeLine() {
                let text = String(decoding: line, as: UTF8.self)
                line.removeAll(keepingCapacity: true)
                if text.isEmpty {
                    if !dataLines.isEmpty {
                        var event = [
                            "event": eventType.isEmpty ? "message" : eventType,
                            "data": dataLines.joined(separator: "\n"),
                        ]
                        if let lastEventID { event["id"] = lastEventID }
                        events.append(event)
                    }
                    dataLines.removeAll(keepingCapacity: true)
                    eventType = ""
                    return
                }
                guard !text.hasPrefix(":") else { return }
                let colon = text.firstIndex(of: ":")
                let name = colon.map { String(text[..<$0]) } ?? text
                var value = colon.map { String(text[text.index(after: $0)...]) } ?? ""
                if value.first == " " { value.removeFirst() }
                switch name {
                case "data": dataLines.append(value)
                case "event": eventType = value
                case "id" where !value.contains("\0"): lastEventID = value
                default: break
                }
            }

            for try await byte in bytes {
                byteCount += 1
                guard byteCount <= Self.maxBodyBytes else { throw RequestSessionError.bodyTooLarge }
                if skipLineFeed {
                    skipLineFeed = false
                    if byte == 10 { continue }
                }
                if byte == 13 {
                    consumeLine()
                    skipLineFeed = true
                } else if byte == 10 {
                    consumeLine()
                } else {
                    line.append(byte)
                }
                if events.count == spec.maxEvents { break }
            }
            guard events.count == spec.maxEvents else { throw RequestSessionError.endedEarly("SSE stream ended before maxEvents") }
            return record(
                resolved,
                startedAt: startedAt,
                status: http.statusCode,
                headers: headerMap(http),
                body: try JSONSerialization.data(withJSONObject: ["events": events]),
            )
        } onCancel: {
            urlSession.invalidateAndCancel()
        }
    }

    private func record(
        _ resolved: ResolvedRequest,
        startedAt: Date,
        status: Int?,
        headers: [String: [String]],
        body: Data,
    ) -> NetworkRequest {
        NetworkRequest(
            url: resolved.url.absoluteString,
            method: resolved.method,
            status: status,
            startTime: Int64(startedAt.timeIntervalSince1970 * 1000),
            duration: elapsed(since: startedAt),
            requestHeaders: resolved.headers.mapValues { [$0] },
            responseHeaders: headers,
            responseBodySize: Int64(body.count),
            responseBody: String(decoding: body, as: UTF8.self),
            source: .urlSession,
        )
    }

    private func headerMap(_ response: HTTPURLResponse?) -> [String: [String]] {
        Dictionary(uniqueKeysWithValues: (response?.allHeaderFields ?? [:]).map { (String(describing: $0.key), [String(describing: $0.value)]) })
    }

    private func validate(maximum: Int, timeoutMs: Int, label: String) throws {
        guard (1...10_000).contains(maximum), (1...3_600_000).contains(timeoutMs) else { throw RequestSessionError.invalidLimits(label) }
    }

    private func elapsed(since date: Date) -> Int64 { Int64(Date().timeIntervalSince(date) * 1000) }

    private func withTimeout<T: Sendable>(milliseconds: Int, operation: @escaping @Sendable () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask(operation: operation)
            group.addTask { try await Task.sleep(for: .milliseconds(milliseconds)); throw RequestSessionError.timeout }
            guard let value = try await group.next() else { throw RequestSessionError.timeout }
            group.cancelAll()
            return value
        }
    }
}

enum RequestSessionError: Error {
    case invalidURL(String)
    case invalidLimits(String)
    case invalidFrame
    case invalidResponse(String)
    case endedEarly(String)
    case bodyTooLarge
    case timeout
}
