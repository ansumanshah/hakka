import Foundation
import Testing
@testable import HakkaNetwork
import HakkaCommon

@Suite("HakkaURLProtocol edge cases", .serialized)
struct URLProtocolEdgeTests {
    @Test func authChallengeSenderForwardsClientDecision() throws {
        let (protocolInstance, client) = makeProtocol(url: "https://auth.example.test")
        let challenge = makeChallenge()

        var forwardedDisposition: URLSession.AuthChallengeDisposition?
        var forwardedCredential: URLCredential?

        protocolInstance.urlSession(URLSession(configuration: .ephemeral), didReceive: challenge) { disposition, credential in
            forwardedDisposition = disposition
            forwardedCredential = credential
        }

        let wrappedChallenge = try #require(client.receivedChallenges.first)
        let wrappedSender = try #require(wrappedChallenge.sender)
        let credential = URLCredential(user: "alice", password: "secret", persistence: .none)

        wrappedSender.use(credential, for: wrappedChallenge)

        #expect(forwardedDisposition == .useCredential)
        #expect(forwardedCredential === credential)
    }

    @Test func authChallengeSenderForwardsNonCredentialDecisions() throws {
        try expectChallengeDecision(.cancelAuthenticationChallenge) { sender, challenge in
            sender.cancel(challenge)
        }

        try expectChallengeDecision(.performDefaultHandling) { sender, challenge in
            guard let performDefaultHandling = sender.performDefaultHandling else {
                Issue.record("Challenge sender did not expose performDefaultHandling")
                return
            }
            performDefaultHandling(challenge)
        }

        try expectChallengeDecision(.rejectProtectionSpace) { sender, challenge in
            guard let rejectProtectionSpaceAndContinue = sender.rejectProtectionSpaceAndContinue else {
                Issue.record("Challenge sender did not expose rejectProtectionSpaceAndContinue")
                return
            }
            rejectProtectionSpaceAndContinue(challenge)
        }
    }

    @Test func authChallengeContinueWithoutCredentialForwardsNilCredential() throws {
        let result = try challengeDecision { sender, challenge in
            sender.continueWithoutCredential(for: challenge)
        }

        #expect(result.disposition == .useCredential)
        #expect(result.credential == nil)
    }

    @Test func redirectNotifiesClientAndPreservesRecursionPreventionTag() throws {
        let interceptor = HakkaInterceptor()
        interceptor.start()
        defer { interceptor.stop() }

        let original = URLRequest(url: try #require(URL(string: "https://api.example.test/start")))
        let redirected = URLRequest(url: try #require(URL(string: "https://api.example.test/final")))
        #expect(HakkaURLProtocol.canInit(with: redirected))

        let (protocolInstance, client) = makeProtocol(request: original)
        let originalURL = try #require(original.url)
        let response = try #require(HTTPURLResponse(
            url: originalURL,
            statusCode: 302,
            httpVersion: "HTTP/1.1",
            headerFields: ["Location": redirected.url!.absoluteString]
        ))
        let session = URLSession(configuration: .ephemeral)

        var completionRequest: URLRequest?
        protocolInstance.urlSession(
            session,
            task: session.dataTask(with: original),
            willPerformHTTPRedirection: response,
            newRequest: redirected
        ) { request in
            completionRequest = request
        }

        let clientRequest = try #require(client.redirectedRequest)
        let completedRequest = try #require(completionRequest)

        #expect(client.redirectResponse === response)
        #expect(clientRequest.url == redirected.url)
        #expect(completedRequest.url == redirected.url)
        #expect(!HakkaURLProtocol.canInit(with: clientRequest))
        #expect(!HakkaURLProtocol.canInit(with: completedRequest))
    }

    @Test func cacheOnlyRequestsAreNotIntercepted() throws {
        let interceptor = HakkaInterceptor()
        interceptor.start()
        defer { interceptor.stop() }

        let url = try #require(URL(string: "https://cache.example.test/resource"))
        let request = URLRequest(url: url, cachePolicy: .returnCacheDataDontLoad)

        #expect(!HakkaURLProtocol.canInit(with: request))
    }

    @Test func stopLoadingRemovesRegisteredInFlightRequest() async throws {
        let interceptor = HakkaInterceptor()
        interceptor.start()
        defer { interceptor.stop() }

        let (protocolInstance, _) = makeProtocol(url: "https://cancel.example.test/in-flight")

        protocolInstance.startLoading()
        try await waitUntil {
            !interceptor.inFlightRequests().isEmpty
        }

        #expect(interceptor.inFlightRequests().count == 1)

        protocolInstance.stopLoading()

        #expect(interceptor.inFlightRequests().isEmpty)
    }

    @Test func completedRequestsCaptureForwardedDataWithoutDroppingClientBytes() throws {
        let interceptor = HakkaInterceptor()
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        let body = Data("response-body".utf8)
        let (protocolInstance, client) = makeProtocol(url: "https://api.example.test/body")
        let requestURL = try #require(protocolInstance.request.url)
        let response = try #require(HTTPURLResponse(
            url: requestURL,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/plain"]
        ))
        let session = URLSession(configuration: .ephemeral)
        let task = session.dataTask(with: protocolInstance.request)

        protocolInstance.urlSession(
            session,
            dataTask: task,
            didReceive: response
        ) { disposition in
            #expect(disposition == .allow)
        }
        protocolInstance.urlSession(session, dataTask: task, didReceive: body)
        protocolInstance.urlSession(session, task: task, didCompleteWithError: nil)
        interceptor.flushCaptureProcessing()

        let captured = try #require(interceptor.store.requests.first)
        #expect(client.receivedResponses.count == 1)
        #expect(client.loadedData == body)
        #expect(client.didFinishCount == 1)
        #expect(captured.responseBodySize == Int64(body.count))
        #expect(captured.responseBody == "response-body")
    }

    @Test func responseBodySizeTracksTotalBytesWhenStoredPreviewIsTruncated() throws {
        let interceptor = HakkaInterceptor(config: HakkaConfig(maxBodySize: 4))
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        let firstChunk = Data("abc".utf8)
        let secondChunk = Data("defgh".utf8)
        let (protocolInstance, client) = makeProtocol(url: "https://api.example.test/large-body")
        let requestURL = try #require(protocolInstance.request.url)
        let response = try #require(HTTPURLResponse(
            url: requestURL,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/plain"]
        ))
        let session = URLSession(configuration: .ephemeral)
        let task = session.dataTask(with: protocolInstance.request)

        protocolInstance.urlSession(
            session,
            dataTask: task,
            didReceive: response
        ) { disposition in
            #expect(disposition == .allow)
        }
        protocolInstance.urlSession(session, dataTask: task, didReceive: firstChunk)
        protocolInstance.urlSession(session, dataTask: task, didReceive: secondChunk)
        protocolInstance.urlSession(session, task: task, didCompleteWithError: nil)
        interceptor.flushCaptureProcessing()

        let captured = try #require(interceptor.store.requests.first)
        #expect(client.loadedData == firstChunk + secondChunk)
        #expect(captured.responseBodySize == Int64(firstChunk.count + secondChunk.count))
        #expect(captured.responseBody == "abcd")
    }

    @Test func bodyStreamMockCaptureKeepsRequestBodyVisibleToCapturePipeline() async throws {
        MockEngine.shared.clearRules()
        defer { MockEngine.shared.clearRules() }

        let interceptor = HakkaInterceptor()
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        let body = Data("streamed-request-body".utf8)
        var request = URLRequest(url: try #require(URL(string: "https://api.example.test/upload")))
        request.httpMethod = "POST"
        request.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        request.httpBodyStream = InputStream(data: body)

        MockEngine.shared.addRule(MockRuleInput(
            pattern: "/upload",
            method: "POST",
            response: MockResponse(
                status: 201,
                headers: ["Content-Type": "text/plain"],
                body: "ok"
            )
        ))

        let (protocolInstance, client) = makeProtocol(request: request)

        protocolInstance.startLoading()
        try await waitUntil {
            client.didFinishCount == 1
        }
        interceptor.flushCaptureProcessing()

        let captured = try #require(interceptor.store.requests.first)

        #expect(request.httpBodyStream != nil)
        #expect(client.loadedData == Data("ok".utf8))
        #expect(captured.status == 201)
        #expect(captured.requestBodySize == Int64(body.count))
        #expect(captured.requestBody == "streamed-request-body")
    }

    // MARK: - Per-request opt-out

    @Test func xHakkaIgnoreHeaderSkipsCaptureInCanInit() throws {
        let interceptor = HakkaInterceptor()
        interceptor.start()
        defer { interceptor.stop() }

        var request = URLRequest(url: try #require(URL(string: "https://api.example.test/secret")))
        request.setValue("1", forHTTPHeaderField: "x-hakka-ignore")

        #expect(!HakkaURLProtocol.canInit(with: request))
    }

    @Test func requestWithoutIgnoreHeaderIsCapturedNormally() throws {
        let interceptor = HakkaInterceptor()
        interceptor.start()
        defer { interceptor.stop() }

        let request = URLRequest(url: try #require(URL(string: "https://api.example.test/normal")))
        #expect(HakkaURLProtocol.canInit(with: request))
    }

    // MARK: - Trace header injection

    @Test func traceHeaderInjectedWhenEnabled() throws {
        let config = HakkaConfig(traceEnabled: true)
        let interceptor = HakkaInterceptor(config: config)
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        let body = Data("response".utf8)
        let (protocolInstance, client) = makeProtocol(url: "https://api.example.test/trace")
        let requestURL = try #require(protocolInstance.request.url)
        let response = try #require(HTTPURLResponse(
            url: requestURL,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/plain"]
        ))
        let session = URLSession(configuration: .ephemeral)
        let task = session.dataTask(with: protocolInstance.request)

        protocolInstance.startLoading()
        protocolInstance.urlSession(session, dataTask: task, didReceive: response) { _ in }
        protocolInstance.urlSession(session, dataTask: task, didReceive: body)
        protocolInstance.urlSession(session, task: task, didCompleteWithError: nil)
        interceptor.flushCaptureProcessing()

        let captured = try #require(interceptor.store.requests.first)
        #expect(captured.correlationId != nil)
        #expect(client.didFinishCount == 0 || captured.correlationId != nil)
        // correlationId must be a non-empty UUID-like string
        let cid = try #require(captured.correlationId)
        #expect(!cid.isEmpty)
    }

    @Test func traceHeaderNotInjectedWhenDisabled() throws {
        let config = HakkaConfig(traceEnabled: false)
        let interceptor = HakkaInterceptor(config: config)
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        let body = Data("response".utf8)
        let (protocolInstance, client) = makeProtocol(url: "https://api.example.test/no-trace")
        let requestURL = try #require(protocolInstance.request.url)
        let response = try #require(HTTPURLResponse(
            url: requestURL,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/plain"]
        ))
        let session = URLSession(configuration: .ephemeral)
        let task = session.dataTask(with: protocolInstance.request)

        protocolInstance.urlSession(session, dataTask: task, didReceive: response) { _ in }
        protocolInstance.urlSession(session, dataTask: task, didReceive: body)
        protocolInstance.urlSession(session, task: task, didCompleteWithError: nil)
        interceptor.flushCaptureProcessing()

        let captured = try #require(interceptor.store.requests.first)
        #expect(captured.correlationId == nil)
        _ = client  // suppress unused warning
    }

    @Test func traceHeaderNotInjectedForUnallowlistedHostWhenAllowlistConfigured() throws {
        let config = HakkaConfig(traceEnabled: true, tracePropagateOrigins: ["safe.example.test"])
        let interceptor = HakkaInterceptor(config: config)
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        let body = Data("response".utf8)
        let (protocolInstance, client) = makeProtocol(url: "https://third-party.test/resource")
        let requestURL = try #require(protocolInstance.request.url)
        let response = try #require(HTTPURLResponse(
            url: requestURL,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/plain"]
        ))
        let session = URLSession(configuration: .ephemeral)
        let task = session.dataTask(with: protocolInstance.request)

        protocolInstance.urlSession(session, dataTask: task, didReceive: response) { _ in }
        protocolInstance.urlSession(session, dataTask: task, didReceive: body)
        protocolInstance.urlSession(session, task: task, didCompleteWithError: nil)
        interceptor.flushCaptureProcessing()

        let captured = try #require(interceptor.store.requests.first)
        #expect(captured.correlationId == nil)
        _ = client
    }

    // MARK: - Rewrite path (block / redirectTo / modify)
    //
    // Mirrors `packages/hakka-core/src/capture/fetch.ts`'s block/rewrite semantics —
    // see also `packages/hakka-core/src/engine/MockEngine.ts`'s `applyRewriteRequest`/
    // `applyRewriteResponse`. Kept in THIS suite (not a separate one) because
    // `HakkaURLProtocol.interceptor` is a shared static — a second `.serialized`
    // Suite touching it would still run concurrently with this one under Swift
    // Testing's default parallel scheduling and race on that static.
    //
    // `startLoading()` is called for real (so the private `pendingRewriteRule`/
    // mock-check branching runs exactly as in production), but the underlying
    // real network attempt targets an RFC 2606 `.test` host that can never
    // resolve — the delegate callbacks are then driven manually (the same
    // technique `traceHeaderInjectedWhenEnabled` above already relies on), so
    // assertions never depend on real network timing.

    @Test func blockAbortsWithNetworkErrorShapedFailureAndRecordsCapture() throws {
        MockEngine.shared.clearRules()
        defer { MockEngine.shared.clearRules() }

        let interceptor = HakkaInterceptor()
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        MockEngine.shared.addRule(MockRuleInput(
            pattern: "/blocked",
            response: MockResponse(status: 200),
            block: true
        ))

        let (protocolInstance, client) = makeProtocol(url: "https://api.example.test/blocked")
        protocolInstance.startLoading()

        #expect(client.didFinishCount == 0)
        let failure = try #require(client.failures.first as NSError?)
        #expect(failure.domain == NSURLErrorDomain)
        #expect(failure.localizedDescription == "Blocked by Hakka")

        interceptor.flushCaptureProcessing()
        let captured = try #require(interceptor.store.requests.first)
        #expect(captured.status == nil)
        #expect(captured.error == "Blocked by Hakka")
    }

    @Test func blockTakesPriorityOverRedirectToAndModify() throws {
        MockEngine.shared.clearRules()
        defer { MockEngine.shared.clearRules() }

        let interceptor = HakkaInterceptor()
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        MockEngine.shared.addRule(MockRuleInput(
            pattern: "/blocked-with-redirect",
            response: MockResponse(status: 200),
            redirectTo: "https://redirected.example.test/never-hit",
            block: true,
            modify: MockRuleModify(status: 999)
        ))

        let (protocolInstance, client) = makeProtocol(url: "https://api.example.test/blocked-with-redirect")
        protocolInstance.startLoading()

        interceptor.flushCaptureProcessing()
        let captured = try #require(interceptor.store.requests.first)
        #expect(captured.error == "Blocked by Hakka")
        // Never rewritten — the original URL is what's recorded, block short-circuited first.
        #expect(captured.url.contains("api.example.test"))
        _ = client
    }

    @Test func redirectToRewritesOutgoingURLAndIsRecordedAsUrlSessionSource() throws {
        MockEngine.shared.clearRules()
        defer { MockEngine.shared.clearRules() }

        let interceptor = HakkaInterceptor()
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        MockEngine.shared.addRule(MockRuleInput(
            pattern: "/original",
            response: MockResponse(status: 200),
            redirectTo: "https://redirected.example.test/target"
        ))

        let (protocolInstance, client) = makeProtocol(url: "https://api.example.test/original")
        protocolInstance.startLoading()

        try driveFakeRealResponse(
            on: protocolInstance,
            status: 200,
            headers: ["Content-Type": "text/plain"],
            body: "real response"
        )

        interceptor.flushCaptureProcessing()
        let captured = try #require(interceptor.store.requests.first)
        #expect(captured.url == "https://redirected.example.test/target")
        #expect(captured.source == .urlSession)
        #expect(captured.responseBody == "real response")
        _ = client
    }

    @Test func modifyEditsRequestHeadersAndQueryParams() throws {
        MockEngine.shared.clearRules()
        defer { MockEngine.shared.clearRules() }

        let interceptor = HakkaInterceptor()
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        MockEngine.shared.addRule(MockRuleInput(
            pattern: "/modify-req",
            response: MockResponse(status: 200),
            modify: MockRuleModify(
                setRequestHeaders: ["X-Injected": "yes"],
                removeRequestHeaders: ["X-Remove-Me"],
                setQueryParams: ["extra": "1"],
                removeQueryParams: ["drop"]
            )
        ))

        var request = URLRequest(url: try #require(URL(string: "https://api.example.test/modify-req?keep=1&drop=2")))
        request.setValue("original", forHTTPHeaderField: "X-Remove-Me")
        let (protocolInstance, _) = makeProtocol(request: request)
        protocolInstance.startLoading()

        try driveFakeRealResponse(on: protocolInstance, status: 200, headers: [:], body: "ok")

        interceptor.flushCaptureProcessing()
        let captured = try #require(interceptor.store.requests.first)
        #expect(captured.url.contains("keep=1"))
        #expect(captured.url.contains("extra=1"))
        #expect(!captured.url.contains("drop="))
        #expect(captured.requestHeaders["X-Injected"]?.first == "yes")
        #expect(captured.requestHeaders["X-Remove-Me"] == nil)
    }

    @Test func modifyEditsResponseStatusHeadersAndBody() throws {
        MockEngine.shared.clearRules()
        defer { MockEngine.shared.clearRules() }

        let interceptor = HakkaInterceptor()
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        MockEngine.shared.addRule(MockRuleInput(
            pattern: "/modify-res",
            response: MockResponse(status: 200),
            modify: MockRuleModify(
                status: 201,
                setResponseHeaders: ["X-Resp": "hi"],
                removeResponseHeaders: ["X-Drop"],
                replaceBody: [MockRuleModify.BodyReplacement(find: "world", replace: "mars")]
            )
        ))

        let (protocolInstance, _) = makeProtocol(url: "https://api.example.test/modify-res")
        protocolInstance.startLoading()

        try driveFakeRealResponse(
            on: protocolInstance,
            status: 200,
            headers: ["X-Drop": "should-vanish", "Content-Type": "text/plain"],
            body: "hello world"
        )

        interceptor.flushCaptureProcessing()
        let captured = try #require(interceptor.store.requests.first)
        #expect(captured.status == 201)
        #expect(captured.responseHeaders["X-Resp"]?.first == "hi")
        #expect(captured.responseHeaders["X-Drop"] == nil)
        #expect(captured.responseBody == "hello mars")
    }

    @Test func modifyComposesWithRedirectTo() throws {
        MockEngine.shared.clearRules()
        defer { MockEngine.shared.clearRules() }

        let interceptor = HakkaInterceptor()
        HakkaURLProtocol.interceptor = interceptor
        defer { HakkaURLProtocol.interceptor = nil }

        MockEngine.shared.addRule(MockRuleInput(
            pattern: "/compose",
            response: MockResponse(status: 200),
            redirectTo: "https://redirected.example.test/compose-target",
            modify: MockRuleModify(setQueryParams: ["via": "modify"], status: 202)
        ))

        let (protocolInstance, _) = makeProtocol(url: "https://api.example.test/compose")
        protocolInstance.startLoading()

        try driveFakeRealResponse(on: protocolInstance, status: 200, headers: [:], body: "body")

        interceptor.flushCaptureProcessing()
        let captured = try #require(interceptor.store.requests.first)
        #expect(captured.url.hasPrefix("https://redirected.example.test/compose-target"))
        #expect(captured.url.contains("via=modify"))
        #expect(captured.status == 202)
    }

    /// Drives the URLSessionDataDelegate callbacks directly on `protocolInstance`
    /// to simulate the real request's response arriving — same technique
    /// `traceHeaderInjectedWhenEnabled` uses above. The `task` parameter is
    /// unused by these delegate method bodies (they read/write `self` instance
    /// state directly), so a throwaway task is fine; the actual background
    /// dataTask issued by `startLoading()` targets an unreachable `.test` host
    /// and either never resolves within the test's lifetime or fails after this
    /// call already completed the request (safely a no-op via
    /// `beginCompletion()`'s guard).
    private func driveFakeRealResponse(
        on protocolInstance: HakkaURLProtocol,
        status: Int,
        headers: [String: String],
        body: String
    ) throws {
        let requestURL = try #require(protocolInstance.request.url)
        let response = try #require(HTTPURLResponse(
            url: requestURL,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ))
        let session = URLSession(configuration: .ephemeral)
        let task = session.dataTask(with: protocolInstance.request)

        protocolInstance.urlSession(session, dataTask: task, didReceive: response) { _ in }
        protocolInstance.urlSession(session, dataTask: task, didReceive: Data(body.utf8))
        protocolInstance.urlSession(session, task: task, didCompleteWithError: nil)
    }

    private func expectChallengeDecision(
        _ expectedDisposition: URLSession.AuthChallengeDisposition,
        action: (URLAuthenticationChallengeSender, URLAuthenticationChallenge) throws -> Void
    ) throws {
        let result = try challengeDecision(action: action)
        #expect(result.disposition == expectedDisposition)
        #expect(result.credential == nil)
    }

    private func challengeDecision(
        action: (URLAuthenticationChallengeSender, URLAuthenticationChallenge) throws -> Void
    ) throws -> (disposition: URLSession.AuthChallengeDisposition?, credential: URLCredential?) {
        let (protocolInstance, client) = makeProtocol(url: "https://auth.example.test")
        let challenge = makeChallenge()

        var forwardedDisposition: URLSession.AuthChallengeDisposition?
        var forwardedCredential: URLCredential?

        protocolInstance.urlSession(URLSession(configuration: .ephemeral), didReceive: challenge) { disposition, credential in
            forwardedDisposition = disposition
            forwardedCredential = credential
        }

        let wrappedChallenge = try #require(client.receivedChallenges.first)
        let wrappedSender = try #require(wrappedChallenge.sender)

        try action(wrappedSender, wrappedChallenge)

        return (forwardedDisposition, forwardedCredential)
    }

    private func makeProtocol(url: String) -> (HakkaURLProtocol, RecordingURLProtocolClient) {
        makeProtocol(request: URLRequest(url: URL(string: url)!))
    }

    private func makeProtocol(request: URLRequest) -> (HakkaURLProtocol, RecordingURLProtocolClient) {
        let client = RecordingURLProtocolClient()
        let protocolInstance = HakkaURLProtocol(request: request, cachedResponse: nil, client: client)
        return (protocolInstance, client)
    }

    private func makeChallenge() -> URLAuthenticationChallenge {
        let protectionSpace = URLProtectionSpace(
            host: "auth.example.test",
            port: 443,
            protocol: NSURLProtectionSpaceHTTPS,
            realm: "hakka",
            authenticationMethod: NSURLAuthenticationMethodHTTPBasic
        )

        return URLAuthenticationChallenge(
            protectionSpace: protectionSpace,
            proposedCredential: nil,
            previousFailureCount: 0,
            failureResponse: nil,
            error: nil,
            sender: RecordingAuthenticationChallengeSender()
        )
    }

    private func waitUntil(
        timeoutNanoseconds: UInt64 = 500_000_000,
        pollNanoseconds: UInt64 = 10_000_000,
        condition: () -> Bool
    ) async throws {
        let started = DispatchTime.now().uptimeNanoseconds
        while !condition() {
            if DispatchTime.now().uptimeNanoseconds - started > timeoutNanoseconds {
                Issue.record("Timed out waiting for condition")
                return
            }
            try await Task.sleep(nanoseconds: pollNanoseconds)
        }
    }
}

private final class RecordingURLProtocolClient: NSObject, URLProtocolClient, @unchecked Sendable {
    var redirectedRequest: URLRequest?
    var redirectResponse: URLResponse?
    var receivedResponses: [URLResponse] = []
    var cachePolicies: [URLCache.StoragePolicy] = []
    var loadedData = Data()
    var didFinishCount = 0
    var failures: [Error] = []
    var receivedChallenges: [URLAuthenticationChallenge] = []
    var cancelledChallenges: [URLAuthenticationChallenge] = []
    var validCachedResponses: [CachedURLResponse] = []

    func urlProtocol(_ protocol: URLProtocol, wasRedirectedTo request: URLRequest, redirectResponse: URLResponse) {
        redirectedRequest = request
        self.redirectResponse = redirectResponse
    }

    func urlProtocol(_ protocol: URLProtocol, cachedResponseIsValid cachedResponse: CachedURLResponse) {
        validCachedResponses.append(cachedResponse)
    }

    func urlProtocol(_ protocol: URLProtocol, didReceive response: URLResponse, cacheStoragePolicy policy: URLCache.StoragePolicy) {
        receivedResponses.append(response)
        cachePolicies.append(policy)
    }

    func urlProtocol(_ protocol: URLProtocol, didLoad data: Data) {
        loadedData.append(data)
    }

    func urlProtocolDidFinishLoading(_ protocol: URLProtocol) {
        didFinishCount += 1
    }

    func urlProtocol(_ protocol: URLProtocol, didFailWithError error: Error) {
        failures.append(error)
    }

    func urlProtocol(_ protocol: URLProtocol, didReceive challenge: URLAuthenticationChallenge) {
        receivedChallenges.append(challenge)
    }

    func urlProtocol(_ protocol: URLProtocol, didCancel challenge: URLAuthenticationChallenge) {
        cancelledChallenges.append(challenge)
    }
}

private final class RecordingAuthenticationChallengeSender: NSObject, URLAuthenticationChallengeSender, @unchecked Sendable {
    func use(_ credential: URLCredential, for challenge: URLAuthenticationChallenge) {}
    func continueWithoutCredential(for challenge: URLAuthenticationChallenge) {}
    func cancel(_ challenge: URLAuthenticationChallenge) {}
    func performDefaultHandling(for challenge: URLAuthenticationChallenge) {}
    func rejectProtectionSpaceAndContinue(with challenge: URLAuthenticationChallenge) {}
}
