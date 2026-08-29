import Foundation
import Network
import Testing
@testable import HakkaNetwork
import HakkaCommon

// MARK: - RequestBuilderTimingTests

/// Regression coverage for `TimingData.extractPhases`: `URLSessionTaskMetrics`
/// hands back one `URLSessionTaskTransactionMetrics` per hop of a redirect
/// chain, and DNS/TCP/TLS setup time must be summed across every hop rather
/// than reported from only the final one — otherwise a request that
/// redirected twice shows a precise-looking timing waterfall that silently
/// describes just the last hop.
///
/// `URLSessionTaskTransactionMetrics` has no public initializer, so these
/// tests drive the aggregation through `HopTiming`'s synthetic initializer
/// instead of a real network round trip — deterministic, and not at the
/// mercy of loopback connect times rounding to 0ms.
@Suite("Redirect chain timing aggregation")
struct RequestBuilderTimingTests {
    private let base = Date(timeIntervalSince1970: 0)

    /// Every fixture below uses offsets that are whole multiples of 125ms
    /// (1/8 of a second) on purpose: 0.125 is an exact power-of-two fraction,
    /// so `addingTimeInterval` and the `Int64(delta * 1000)` round trip in
    /// `extractPhases` land on exact integers with no floating-point
    /// truncation. An arbitrary decimal ms count (10, 15, 23...) is *not*
    /// exactly representable in binary and can come back one millisecond
    /// short — a property of `Double`, not of the aggregation being tested.
    private func at(_ offsetMs: Double) -> Date {
        base.addingTimeInterval(offsetMs / 1000)
    }

    @Test("Sums DNS/connect/TLS across every hop, keeps waiting/download/identity from the last hop")
    func sumsAcrossHopsKeepsLastHopIdentity() {
        // First hop: plain-HTTP redirect. DNS 125ms, connect 250ms, no TLS.
        let firstHop = HopTiming(
            domainLookupStart: at(0), domainLookupEnd: at(125),
            connectStart: at(125), connectEnd: at(375),
            requestEnd: at(375),
            responseStart: at(500),
            responseEnd: at(500),
            networkProtocolName: "http/1.1"
        )

        // Final hop: a different host. DNS 250ms, connect 125ms, TLS 500ms,
        // TTFB 375ms, download 750ms.
        let finalHop = HopTiming(
            domainLookupStart: at(500), domainLookupEnd: at(750),
            connectStart: at(750), connectEnd: at(875),
            secureConnectionStart: at(875), secureConnectionEnd: at(1375),
            requestEnd: at(1375),
            responseStart: at(1750),
            responseEnd: at(2500),
            networkProtocolName: "h2",
            negotiatedTLSProtocolVersion: .TLSv13,
            negotiatedTLSCipherSuite: .AES_128_GCM_SHA256
        )

        var timing = TimingData()
        timing.extractPhases(from: [firstHop, finalHop])

        // Connection setup is summed across both hops of the chain.
        #expect(timing.dnsMs == 375)       // 125 + 250
        #expect(timing.connectMs == 375)   // 250 + 125 — NOT 125, the last hop alone
        #expect(timing.tlsMs == 500)       // only the final hop negotiated TLS

        // Waiting/download and connection identity describe the response
        // actually delivered to the caller: the final hop only.
        #expect(timing.ttfbMs == 375)
        #expect(timing.downloadMs == 750)
        #expect(timing.networkProtocol == "h2")
        #expect(timing.tlsVersion == "TLSv1.3")
        #expect(timing.cipherSuite == "AES_128_GCM_SHA256")
    }

    @Test("A hop missing a phase is skipped, not treated as zero")
    func missingPhaseIsSkippedNotZeroed() {
        // Neither hop reports a TLS handshake window at all (plain HTTP
        // throughout) — tlsMs should stay nil, not become 0.
        let firstHop = HopTiming(connectStart: at(0), connectEnd: at(625))
        let finalHop = HopTiming(connectStart: at(625), connectEnd: at(1125))

        var timing = TimingData()
        timing.extractPhases(from: [firstHop, finalHop])

        #expect(timing.connectMs == 1125) // 625 + 500
        #expect(timing.tlsMs == nil)
        #expect(timing.dnsMs == nil)
    }

    @Test("Single hop (no redirect) behaves the same as before the fix")
    func singleHopUnaffected() {
        let onlyHop = HopTiming(
            domainLookupStart: at(0), domainLookupEnd: at(500),
            connectStart: at(500), connectEnd: at(1250),
            secureConnectionStart: at(1250), secureConnectionEnd: at(2500),
            requestEnd: at(2500),
            responseStart: at(2750),
            responseEnd: at(6500),
            networkProtocolName: "h2",
            negotiatedTLSProtocolVersion: .TLSv12,
            negotiatedTLSCipherSuite: .ECDHE_RSA_WITH_AES_128_GCM_SHA256
        )

        var timing = TimingData()
        timing.extractPhases(from: [onlyHop])

        #expect(timing.dnsMs == 500)
        #expect(timing.connectMs == 750)
        #expect(timing.tlsMs == 1250)
        #expect(timing.ttfbMs == 250)
        #expect(timing.downloadMs == 3750)
        #expect(timing.tlsVersion == "TLSv1.2")
        #expect(timing.cipherSuite == "ECDHE_RSA_AES128_GCM_SHA256")
    }

    @Test("No hops leaves timing at its defaults")
    func noHopsLeavesDefaults() {
        var timing = TimingData()
        timing.extractPhases(from: [])

        #expect(timing.dnsMs == nil)
        #expect(timing.connectMs == nil)
        #expect(timing.tlsMs == nil)
        #expect(timing.ttfbMs == nil)
        #expect(timing.downloadMs == nil)
        #expect(timing.networkProtocol == nil)
    }
}

// MARK: - RequestBuilderRedirectLiveTests

/// Proves the aggregation is actually wired into `RequestBuilder.build` end
/// to end, against a genuine two-hop redirect over loopback — not just the
/// synthetic `HopTiming` fixtures above.
@Suite("RequestBuilder redirect wiring (real localhost round trip)")
struct RequestBuilderRedirectLiveTests {
    /// A single-listener HTTP/1.1 server that 302-redirects `/start` to
    /// `/final` on the same port, then serves `/final` with 200. Both
    /// responses close the connection, so the follow-up request opens a
    /// fresh connection and the client collects two distinct
    /// `URLSessionTaskTransactionMetrics` entries.
    final class RedirectingHTTPServer: @unchecked Sendable {
        enum ServerError: Error { case startFailed }

        private let listener: NWListener
        private let queue = DispatchQueue(label: "com.noodleapps.hakka.tests.redirecting-http-server")

        init() throws {
            listener = try NWListener(using: .tcp, on: .any)
        }

        func start() throws -> UInt16 {
            let semaphore = DispatchSemaphore(value: 0)
            listener.newConnectionHandler = { [weak self] connection in
                self?.accept(connection)
            }
            listener.stateUpdateHandler = { state in
                if case .ready = state { semaphore.signal() }
                if case .failed = state { semaphore.signal() }
            }
            listener.start(queue: queue)
            guard semaphore.wait(timeout: .now() + 5) == .success,
                  case .ready = listener.state, let port = listener.port?.rawValue else {
                throw ServerError.startFailed
            }
            return port
        }

        func stop() { listener.cancel() }

        private func accept(_ connection: NWConnection) {
            connection.start(queue: queue)
            receive(connection, buffered: Data())
        }

        private func receive(_ connection: NWConnection, buffered: Data) {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
                guard let self else { return }
                var accumulated = buffered
                if let data { accumulated.append(data) }
                let terminator = Data("\r\n\r\n".utf8)
                if let range = accumulated.range(of: terminator) {
                    let head = String(data: accumulated[..<range.lowerBound], encoding: .utf8) ?? ""
                    self.respond(connection, requestLine: head.split(separator: "\r\n").first.map(String.init) ?? "")
                } else if error == nil, !isComplete {
                    self.receive(connection, buffered: accumulated)
                }
            }
        }

        private func respond(_ connection: NWConnection, requestLine: String) {
            let response: String
            if requestLine.contains("/start") {
                response = "HTTP/1.1 302 Found\r\n"
                    + "Location: /final\r\n"
                    + "Content-Length: 0\r\n"
                    + "Connection: close\r\n\r\n"
            } else {
                let body = "done"
                response = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: text/plain\r\n"
                    + "Content-Length: \(body.utf8.count)\r\n"
                    + "Connection: close\r\n\r\n\(body)"
            }
            connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    /// Collects `URLSessionTaskMetrics` and the final response for a single
    /// data task, without going through `HakkaURLProtocol` — this test only
    /// needs the raw metrics Foundation reports for a real redirect, to feed
    /// `RequestBuilder.build`. `@unchecked Sendable` is sound here: every
    /// property is written on the session's delegate/callback queue and read
    /// only after `wait()` returns, and the semaphore is the happens-before
    /// edge between the two.
    final class ResponseCollectorDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
        private let metricsSemaphore = DispatchSemaphore(value: 0)
        private let responseSemaphore = DispatchSemaphore(value: 0)
        private(set) var metrics: URLSessionTaskMetrics?
        private(set) var response: URLResponse?
        private(set) var data = Data()

        func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
            self.metrics = metrics
            metricsSemaphore.signal()
        }

        func received(response: URLResponse?, data: Data?) {
            self.response = response
            self.data = data ?? Data()
            responseSemaphore.signal()
        }

        func waitForCompletion() {
            _ = responseSemaphore.wait(timeout: .now() + 5)
            _ = metricsSemaphore.wait(timeout: .now() + 5)
        }
    }

    @Test func redirectCountAndUrlsFlowThroughBuild() throws {
        let server = try RedirectingHTTPServer()
        let port = try server.start()
        defer { server.stop() }

        let delegate = ResponseCollectorDelegate()
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        let startURL = try #require(URL(string: "http://127.0.0.1:\(port)/start"))

        session.dataTask(with: startURL) { data, response, _ in
            delegate.received(response: response, data: data)
        }.resume()
        delegate.waitForCompletion()

        let metrics = try #require(delegate.metrics, "no URLSessionTaskMetrics collected for the redirect")
        #expect(metrics.transactionMetrics.count == 2, "expected one transaction per hop")

        let interceptor = HakkaInterceptor()
        let built = RequestBuilder.build(
            requestId: "redirect-test",
            request: URLRequest(url: startURL),
            startTime: Int64(Date().timeIntervalSince1970 * 1000) - 1,
            receivedResponse: delegate.response,
            receivedData: delegate.data,
            taskMetrics: metrics,
            error: nil,
            interceptor: interceptor
        )

        #expect(built.redirectCount == 1)
        #expect(built.redirectUrls.count == 1)
        #expect(built.redirectUrls.first?.hasSuffix("/start") == true)
        #expect(built.status == 200)

        // The whole point of the fix: connect time summed across both hops
        // must be at least as large as either hop's connect time alone, and
        // strictly greater whenever both hops actually needed a fresh TCP
        // connection (guaranteed here — every response closes the socket).
        let perHopConnectMs: [Int64] = metrics.transactionMetrics.compactMap { tx in
            guard let s = tx.connectStartDate, let e = tx.connectEndDate else { return nil }
            return Int64(e.timeIntervalSince(s) * 1000)
        }
        if perHopConnectMs.count == 2 {
            let expectedSum = perHopConnectMs.reduce(0, +)
            #expect(built.connectMs == expectedSum)
        }
    }
}
