import Foundation
import Network

/// The real `OAuth2LoopbackListening`: binds `127.0.0.1` explicitly (never
/// `0.0.0.0` — `requiredLocalEndpoint` is what makes that a bind-time
/// guarantee rather than a firewall's job), accepts exactly one connection,
/// and cancels the `NWListener` on every exit path — success, timeout, and
/// task cancellation all release the port before this method returns.
public final class NWLoopbackListener: OAuth2LoopbackListening, @unchecked Sendable {
    public init() {}

    public func awaitCallback(port: Int, timeout: TimeInterval) async throws -> URL {
        guard let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
            throw OAuth2FlowError.transport("invalid loopback port \(port)")
        }
        let host = "127.0.0.1:\(port)"

        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: nwPort)
        params.allowLocalEndpointReuse = true

        let listener: NWListener
        do {
            listener = try NWListener(using: params, on: nwPort)
        } catch {
            throw OAuth2FlowError.transport("could not bind 127.0.0.1:\(port): \(error.localizedDescription)")
        }

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let outcome = SingleResume(continuation: continuation)
                let queue = DispatchQueue(label: "hakka.oauth2.loopback")

                listener.newConnectionHandler = { connection in
                    Self.handle(connection: connection, host: host, queue: queue, outcome: outcome, listener: listener)
                }
                listener.stateUpdateHandler = { state in
                    if case let .failed(error) = state {
                        outcome.resume(throwing: OAuth2FlowError.transport(error.localizedDescription))
                        listener.cancel()
                    }
                }
                listener.start(queue: queue)

                queue.asyncAfter(deadline: .now() + timeout) {
                    outcome.resume(throwing: OAuth2FlowError.callbackTimedOut)
                    listener.cancel()
                }
            }
        } onCancel: {
            listener.cancel()
        }
    }

    private static func handle(
        connection: NWConnection,
        host: String,
        queue: DispatchQueue,
        outcome: SingleResume<URL>,
        listener: NWListener,
    ) {
        connection.start(queue: queue)
        receive(connection: connection, buffer: Data(), host: host, outcome: outcome, listener: listener)
    }

    private static func receive(
        connection: NWConnection,
        buffer: Data,
        host: String,
        outcome: SingleResume<URL>,
        listener: NWListener,
    ) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, isComplete, error in
            var buffer = buffer
            if let data { buffer.append(data) }

            if let url = LoopbackHTTPParsing.requestURL(from: buffer, host: host) {
                connection.send(
                    content: LoopbackHTTPParsing.successResponseBytes(),
                    completion: .contentProcessed { _ in connection.cancel() },
                )
                outcome.resume(returning: url)
                listener.cancel()
                return
            }

            if isComplete || error != nil || buffer.count >= LoopbackHTTPParsing.maxBytes {
                connection.cancel()
                return
            }
            receive(connection: connection, buffer: buffer, host: host, outcome: outcome, listener: listener)
        }
    }
}

/// A completion value that resumes a `CheckedContinuation` at most once.
/// Three call sites race to resume it (a real callback, the timeout, and a
/// listener failure) and only the first may win — a second resume on a
/// `CheckedContinuation` is a crash, not a no-op.
final class SingleResume<Value: Sendable>: @unchecked Sendable {
    private let continuation: CheckedContinuation<Value, Error>
    private let lock = NSLock()
    private var settled = false

    init(continuation: CheckedContinuation<Value, Error>) {
        self.continuation = continuation
    }

    func resume(returning value: Value) {
        guard claim() else { return }
        continuation.resume(returning: value)
    }

    func resume(throwing error: Error) {
        guard claim() else { return }
        continuation.resume(throwing: error)
    }

    private func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !settled else { return false }
        settled = true
        return true
    }
}
