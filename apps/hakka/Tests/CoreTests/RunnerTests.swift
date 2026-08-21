import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

// MARK: - Fixtures

private func sampleRecord(
    status: Int? = 200,
    duration: Int64? = 42,
    responseBody: String? = #"{"data":{"token":"abc123","items":[{"id":1},{"id":2}],"nil":null}}"#,
    responseHeaders: [String: [String]] = ["X-Trace": ["xyz"]],
) -> NetworkRequest {
    NetworkRequest(
        url: "https://api.example.com/x",
        method: .get,
        status: status,
        startTime: 0,
        duration: duration,
        responseHeaders: responseHeaders,
        responseBody: responseBody,
        source: .urlSession,
    )
}

private struct StubTransport: RequestTransport {
    let handler: @Sendable (URLRequest, Bool) async throws -> TransportResponse

    func execute(_ request: URLRequest, followRedirects: Bool) async throws -> TransportResponse {
        try await handler(request, followRedirects)
    }
}

private func jsonResponse(_ body: String, status: Int = 200, headers: [String: String] = [:]) -> TransportResponse {
    let response = HTTPURLResponse(
        url: URL(string: "https://api.example.com")!,
        statusCode: status,
        httpVersion: "HTTP/1.1",
        headerFields: headers,
    )!
    return TransportResponse(data: Data(body.utf8), response: response)
}

// MARK: - JSON path

@Suite("JSONPathEvaluator")
struct JSONPathEvaluatorTests {
    private let json = try! JSONSerialization.jsonObject(
        with: Data(#"{"data":{"items":[{"id":1},{"id":2}]},"count":3,"ok":true}"#.utf8),
    )

    @Test func dotPathIntoNestedObject() {
        #expect(JSONPathEvaluator.stringify(JSONPathEvaluator.value(at: "data.items[0].id", in: json)) == "1")
    }

    @Test func chainedIndexOnArray() {
        #expect(JSONPathEvaluator.stringify(JSONPathEvaluator.value(at: "data.items[1].id", in: json)) == "2")
    }

    @Test func missingKeyIsNil() {
        #expect(JSONPathEvaluator.value(at: "data.nope", in: json) == nil)
    }

    @Test func outOfRangeIndexIsNil() {
        #expect(JSONPathEvaluator.value(at: "data.items[5]", in: json) == nil)
    }

    @Test func rootScalarStringifies() {
        #expect(JSONPathEvaluator.stringify(JSONPathEvaluator.value(at: "count", in: json)) == "3")
        #expect(JSONPathEvaluator.stringify(JSONPathEvaluator.value(at: "ok", in: json)) == "true")
    }
}

// MARK: - Assertions

@Suite("AssertionEvaluator")
struct AssertionEvaluatorTests {
    private func assertion(_ target: AssertionTarget, _ op: AssertionOperator, _ expected: String) -> Assertion {
        Assertion(target: target, op: op, expected: expected)
    }

    @Test func statusEquals() {
        let result = AssertionEvaluator.evaluate(assertion(.status, .equals, "200"), against: sampleRecord())
        #expect(result.passed)
    }

    @Test func statusNotEqualsFailsOnMatch() {
        let result = AssertionEvaluator.evaluate(assertion(.status, .notEquals, "200"), against: sampleRecord())
        #expect(!result.passed)
    }

    @Test func durationLessThan() {
        let result = AssertionEvaluator.evaluate(assertion(.durationMs, .lessThan, "100"), against: sampleRecord())
        #expect(result.passed)
    }

    @Test func durationGreaterThanFails() {
        let result = AssertionEvaluator.evaluate(assertion(.durationMs, .greaterThan, "100"), against: sampleRecord())
        #expect(!result.passed)
    }

    @Test func headerContains() {
        let result = AssertionEvaluator.evaluate(assertion(.header(name: "X-Trace"), .contains, "yz"), against: sampleRecord())
        #expect(result.passed)
    }

    @Test func headerNotContains() {
        let result = AssertionEvaluator.evaluate(assertion(.header(name: "X-Trace"), .notContains, "zz"), against: sampleRecord())
        #expect(result.passed)
    }

    @Test func jsonPathEquals() {
        let result = AssertionEvaluator.evaluate(assertion(.jsonPath("data.token"), .equals, "abc123"), against: sampleRecord())
        #expect(result.passed)
    }

    @Test func jsonPathExistsAndNotExists() {
        #expect(AssertionEvaluator.evaluate(assertion(.jsonPath("data.token"), .exists, ""), against: sampleRecord()).passed)
        #expect(AssertionEvaluator.evaluate(assertion(.jsonPath("data.missing"), .notExists, ""), against: sampleRecord()).passed)
    }

    @Test func bodyTextMatchesRegex() {
        let result = AssertionEvaluator.evaluate(assertion(.bodyText, .matches, #"abc\d+"#), against: sampleRecord())
        #expect(result.passed)
    }

    @Test func disabledAssertionAlwaysPasses() {
        let disabled = Assertion(target: .status, op: .equals, expected: "999", enabled: false)
        #expect(AssertionEvaluator.evaluate(disabled, against: sampleRecord()).passed)
    }
}

// MARK: - RequestResolver: header/auth precedence

@Suite("RequestResolver")
struct RequestResolverTests {
    private func collection(defaultHeaders: [HeaderPair] = [], auth: AuthSpec = .none) -> Collection {
        Collection(name: "C", defaultHeaders: defaultHeaders, auth: auth)
    }

    @Test func headerPrecedenceCollectionLtFolderLtRequest() throws {
        let folder = Folder(name: "F", headers: [HeaderPair(name: "X-Level", value: "folder"), HeaderPair(name: "X-Folder-Only", value: "f")])
        let request = RequestSpec(name: "R", url: "https://api.example.com", headers: [HeaderPair(name: "X-Level", value: "request")])
        let coll = collection(defaultHeaders: [HeaderPair(name: "X-Level", value: "collection"), HeaderPair(name: "X-Coll-Only", value: "c")])

        let resolved = try RequestResolver.resolve(request, folderChain: [folder], collection: coll, scope: VariableScope())

        #expect(resolved.headers["X-Level"] == "request")
        #expect(resolved.headers["X-Folder-Only"] == "f")
        #expect(resolved.headers["X-Coll-Only"] == "c")
    }

    @Test func disabledHeaderIsDropped() throws {
        let request = RequestSpec(
            name: "R",
            url: "https://api.example.com",
            headers: [HeaderPair(name: "X-Off", value: "v", enabled: false)],
        )
        let resolved = try RequestResolver.resolve(request, collection: collection(), scope: VariableScope())
        #expect(resolved.headers["X-Off"] == nil)
    }

    @Test func requestAuthOverridesInheritedFolderAndCollectionAuth() throws {
        let folder = Folder(name: "F", auth: .bearer(token: "folder-token"))
        let request = RequestSpec(name: "R", url: "https://api.example.com", auth: .bearer(token: "request-token"))
        let coll = collection(auth: .bearer(token: "collection-token"))

        let resolved = try RequestResolver.resolve(request, folderChain: [folder], collection: coll, scope: VariableScope())
        #expect(resolved.headers["Authorization"] == "Bearer request-token")
    }

    @Test func inheritWalksUpToNearestNonInheritAuth() throws {
        let outer = Folder(name: "Outer", auth: .bearer(token: "outer-token"))
        let inner = Folder(name: "Inner", auth: .inherit)
        let request = RequestSpec(name: "R", url: "https://api.example.com", auth: .inherit)

        let resolved = try RequestResolver.resolve(request, folderChain: [outer, inner], collection: collection(), scope: VariableScope())
        #expect(resolved.headers["Authorization"] == "Bearer outer-token")
    }

    @Test func apiKeyQueryPlacementAppendsToURL() throws {
        let request = RequestSpec(
            name: "R",
            url: "https://api.example.com/x",
            auth: .apiKey(name: "key", value: "secret", placement: .query),
        )
        let resolved = try RequestResolver.resolve(request, collection: collection(), scope: VariableScope())
        #expect(resolved.url.absoluteString.contains("key=secret"))
    }

    @Test func missingVariableRefusesToResolve() {
        let request = RequestSpec(name: "R", url: "https://api.example.com/{{missingVar}}")
        #expect(throws: RequestResolutionError.missingVariables(["missingVar"])) {
            try RequestResolver.resolve(request, collection: collection(), scope: VariableScope())
        }
    }

    @Test func missingVariableAcrossHeaderAndBodyAreAllReported() {
        let request = RequestSpec(
            name: "R",
            url: "https://api.example.com",
            headers: [HeaderPair(name: "X-Token", value: "{{token}}")],
            body: .raw(text: "{{payload}}", contentType: "text/plain"),
        )
        #expect(throws: RequestResolutionError.self) {
            try RequestResolver.resolve(request, collection: collection(), scope: VariableScope())
        }
        do {
            _ = try RequestResolver.resolve(request, collection: collection(), scope: VariableScope())
            Issue.record("expected missingVariables to be thrown")
        } catch let RequestResolutionError.missingVariables(names) {
            #expect(Set(names) == ["token", "payload"])
        } catch {
            Issue.record("unexpected error \(error)")
        }
    }

    @Test func variableScopeResolvesURLHeaderAndBody() throws {
        let scope = VariableScope(environment: ["host": "api.example.com", "token": "tok"])
        let request = RequestSpec(
            name: "R",
            url: "https://{{host}}/x",
            headers: [HeaderPair(name: "Authorization", value: "Bearer {{token}}")],
        )
        let resolved = try RequestResolver.resolve(request, collection: collection(), scope: scope)
        #expect(resolved.url.absoluteString == "https://api.example.com/x")
        #expect(resolved.headers["Authorization"] == "Bearer tok")
    }
}

// MARK: - RequestRunner: send, capture, redirects

@Suite("RequestRunner")
struct RequestRunnerTests {
    private func collection() -> Collection { Collection(name: "C") }

    @Test func captureThenReuseFeedsNextRequest() async throws {
        let runner = RequestRunner(transport: StubTransport { _, _ in
            jsonResponse(#"{"token":"captured-value"}"#)
        })

        let login = RequestSpec(
            name: "Login",
            url: "https://api.example.com/login",
            captures: [ResponseCapture(variable: "authToken", source: .jsonPath("token"))],
        )
        let loginResult = try await runner.run(login, collection: collection(), scope: VariableScope())
        #expect(loginResult.scope.value(for: "authToken") == "captured-value")

        let whoAmI = RequestSpec(
            name: "WhoAmI",
            url: "https://api.example.com/me",
            headers: [HeaderPair(name: "Authorization", value: "Bearer {{authToken}}")],
        )
        let secondResult = try await runner.run(whoAmI, collection: collection(), scope: loginResult.scope)
        #expect(secondResult.record.requestHeaders["Authorization"] == ["Bearer captured-value"])
    }

    @Test func missingVariableRefusalPropagatesFromRunner() async {
        let runner = RequestRunner(transport: StubTransport { _, _ in jsonResponse("{}") })
        let request = RequestSpec(name: "R", url: "https://api.example.com/{{missing}}")

        await #expect(throws: RequestRunnerError.self) {
            try await runner.run(request, collection: collection(), scope: VariableScope())
        }
    }

    @Test func redirectChainAndCountAreRecorded() async throws {
        let runner = RequestRunner(transport: StubTransport { _, followRedirects in
            #expect(followRedirects)
            var response = jsonResponse("{}")
            response = TransportResponse(
                data: response.data,
                response: response.response,
                redirectChain: [URL(string: "https://api.example.com/step2")!, URL(string: "https://api.example.com/final")!],
            )
            return response
        })

        let request = RequestSpec(name: "R", url: "https://api.example.com/start", followRedirects: true)
        let result = try await runner.run(request, collection: collection(), scope: VariableScope())

        #expect(result.record.redirectCount == 2)
        #expect(result.record.redirectUrls == ["https://api.example.com/step2", "https://api.example.com/final"])
    }

    @Test func followRedirectsFalseIsPassedToTransport() async throws {
        let runner = RequestRunner(transport: StubTransport { _, followRedirects in
            #expect(!followRedirects)
            return jsonResponse("{}")
        })
        let request = RequestSpec(name: "R", url: "https://api.example.com/start", followRedirects: false)
        _ = try await runner.run(request, collection: collection(), scope: VariableScope())
    }

    @Test func assertionsEvaluatedAgainstSentResponse() async throws {
        let runner = RequestRunner(transport: StubTransport { _, _ in jsonResponse(#"{"ok":true}"#, status: 201) })
        let request = RequestSpec(
            name: "R",
            url: "https://api.example.com/x",
            assertions: [Assertion(target: .status, op: .equals, expected: "201")],
        )
        let result = try await runner.run(request, collection: collection(), scope: VariableScope())
        #expect(result.assertionResults.count == 1)
        #expect(result.assertionResults[0].passed)
    }

    @Test func transportFailureIsRecordedNotThrown() async throws {
        struct TestError: Error {}
        let runner = RequestRunner(transport: StubTransport { _, _ in throw TestError() })
        let request = RequestSpec(name: "R", url: "https://api.example.com/x")

        let result = try await runner.run(request, collection: collection(), scope: VariableScope())
        #expect(result.record.status == nil)
        #expect(result.record.error != nil)
    }

    @Test func timeoutIsAppliedToTheSentRequest() async throws {
        let runner = RequestRunner(transport: StubTransport { urlRequest, _ in
            #expect(urlRequest.timeoutInterval == 5)
            return jsonResponse("{}")
        })
        let request = RequestSpec(name: "R", url: "https://api.example.com/x", timeout: 5)
        _ = try await runner.run(request, collection: collection(), scope: VariableScope())
    }

    /// A user-set Content-Type header in non-canonical case must win over the
    /// body's implied content type, not coexist with it as a second header —
    /// see RequestResolver/RequestRunner's case-insensitive merge.
    @Test func explicitContentTypeHeaderSurvivesRegardlessOfCase() async throws {
        let runner = RequestRunner(transport: StubTransport { urlRequest, _ in
            let contentTypeKeys = (urlRequest.allHTTPHeaderFields ?? [:]).keys
                .filter { $0.caseInsensitiveCompare("Content-Type") == .orderedSame }
            #expect(contentTypeKeys.count == 1)
            #expect(urlRequest.value(forHTTPHeaderField: "Content-Type") == "application/xml; charset=utf-8")
            return jsonResponse("{}")
        })
        let request = RequestSpec(
            name: "R",
            url: "https://api.example.com/x",
            headers: [HeaderPair(name: "content-type", value: "application/xml; charset=utf-8")],
            body: .raw(text: "<x/>", contentType: "application/xml"),
        )
        let result = try await runner.run(request, collection: collection(), scope: VariableScope())
        let contentTypeHeaders = result.record.requestHeaders.keys
            .filter { $0.caseInsensitiveCompare("Content-Type") == .orderedSame }
        #expect(contentTypeHeaders.count == 1)
    }

    /// The multipart boundary is only known at encode time; the runner must
    /// still fill in the real Content-Type when the user didn't set one.
    @Test func multipartContentTypeCarriesGeneratedBoundary() async throws {
        let runner = RequestRunner(transport: StubTransport { urlRequest, _ in
            let contentType = urlRequest.value(forHTTPHeaderField: "Content-Type")
            #expect(contentType?.hasPrefix("multipart/form-data; boundary=") == true)
            return jsonResponse("{}")
        })
        let request = RequestSpec(
            name: "R",
            url: "https://api.example.com/x",
            body: .multipart([MultipartPart(name: "field", value: "v")]),
        )
        _ = try await runner.run(request, collection: collection(), scope: VariableScope())
    }
}

// MARK: - RedirectTrackingDelegate

@Suite("RedirectTrackingDelegate")
struct RedirectTrackingDelegateTests {
    private func dummyTask() -> URLSessionTask {
        URLSession(configuration: .ephemeral).dataTask(with: URL(string: "https://api.example.com/start")!)
    }

    private func redirectResponse() -> HTTPURLResponse {
        HTTPURLResponse(
            url: URL(string: "https://api.example.com/start")!,
            statusCode: 302,
            httpVersion: "HTTP/1.1",
            headerFields: ["Location": "https://api.example.com/next"],
        )!
    }

    /// A declined redirect (`followRedirects: false`) must not be recorded —
    /// the 3xx response is returned as final, so reporting a redirect chain
    /// would misrepresent it as followed.
    @Test func declinedRedirectIsNotRecorded() async {
        let delegate = RedirectTrackingDelegate(followRedirects: false)
        let task = dummyTask()
        defer { task.cancel() }

        let outcome = await delegate.urlSession(
            URLSession(configuration: .ephemeral),
            task: task,
            willPerformHTTPRedirection: redirectResponse(),
            newRequest: URLRequest(url: URL(string: "https://api.example.com/next")!),
        )

        #expect(outcome == nil)
        #expect(await delegate.redirects().isEmpty)
    }

    @Test func followedRedirectIsRecorded() async {
        let delegate = RedirectTrackingDelegate(followRedirects: true)
        let task = dummyTask()
        defer { task.cancel() }
        let nextURL = URL(string: "https://api.example.com/next")!

        let outcome = await delegate.urlSession(
            URLSession(configuration: .ephemeral),
            task: task,
            willPerformHTTPRedirection: redirectResponse(),
            newRequest: URLRequest(url: nextURL),
        )

        #expect(outcome?.url == nextURL)
        #expect(await delegate.redirects() == [nextURL])
    }
}

// MARK: - RequestBodyEncoder

@Suite("RequestBodyEncoder")
struct RequestBodyEncoderTests {
    @Test func graphQLEncodesQueryAndParsedVariables() throws {
        let encoded = try RequestBodyEncoder.encode(.graphql(query: "{ me }", variables: #"{"id":1}"#, operationName: nil))
        let data = try #require(encoded.data)
        let parsed = try JSONSerialization.jsonObject(with: data)
        let object = try #require(parsed as? [String: Any])
        #expect(object["query"] as? String == "{ me }")
        #expect((object["variables"] as? [String: Any])?["id"] as? Int == 1)
        #expect(object["operationName"] == nil)
    }

    @Test func graphQLIncludesOperationNameWhenSet() throws {
        let encoded = try RequestBodyEncoder.encode(
            .graphql(query: "query A { a } query B { b }", variables: "{}", operationName: "B"),
        )
        let data = try #require(encoded.data)
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["operationName"] as? String == "B")
    }

    @Test func graphQLRejectsInvalidVariablesJSON() {
        #expect(throws: RequestBodyEncodingError.self) {
            try RequestBodyEncoder.encode(.graphql(query: "{ me }", variables: "not json", operationName: nil))
        }
    }

    @Test func fileBodyMissingOnDiskThrows() {
        #expect(throws: RequestBodyEncodingError.self) {
            try RequestBodyEncoder.encode(.file(path: "/nonexistent/\(UUID().uuidString)", contentType: "application/octet-stream"))
        }
    }

    /// A multipart part's `name` reaches the encoder after `{{variable}}`
    /// interpolation, so it can carry a value captured from a prior response.
    /// A `"` or CR/LF in it must not be able to break out of the
    /// `Content-Disposition` quoted-string to smuggle a header or forge a
    /// boundary marker into the request actually sent on the wire.
    @Test func multipartNameCannotInjectHeadersOrBoundary() throws {
        let maliciousName = "field\"\r\nX-Injected: evil\r\n--INJECTED--"
        let part = MultipartPart(name: maliciousName, value: "payload")

        let encoded = try RequestBodyEncoder.encode(.multipart([part]))
        let body = try #require(encoded.data.flatMap { String(data: $0, encoding: .utf8) })

        // No CR/LF survives inside the name, so neither a smuggled header
        // line nor a forged boundary marker can land on its own line.
        #expect(!body.contains("\r\nX-Injected"))
        #expect(!body.contains("\r\n--INJECTED--"))
        // The embedded quote is escaped rather than left to close the
        // quoted-string early.
        #expect(body.contains("name=\"field\\\"X-Injected: evil--INJECTED--\""))
    }

    /// Pins the exact wire framing — CRLF placement, `Content-Disposition`,
    /// the per-part `Content-Type`, the trailing `--boundary--` — against a
    /// fixed expected string. The boundary itself is random per encode, so
    /// it's extracted from the returned `Content-Type` and substituted into
    /// the expected template rather than hardcoded.
    @Test func multipartPinsExactByteFraming() throws {
        let parts = [
            MultipartPart(name: "field1", value: "value1"),
            MultipartPart(name: "field2", value: "value2", contentType: "text/plain"),
        ]
        let encoded = try RequestBodyEncoder.encode(.multipart(parts))
        let contentType = try #require(encoded.contentType)
        let boundary = try #require(contentType.split(separator: "boundary=").last).description
        let body = try #require(encoded.data.flatMap { String(data: $0, encoding: .utf8) })

        let expected = "--\(boundary)\r\n"
            + "Content-Disposition: form-data; name=\"field1\"\r\n\r\n"
            + "value1\r\n"
            + "--\(boundary)\r\n"
            + "Content-Disposition: form-data; name=\"field2\"\r\n"
            + "Content-Type: text/plain\r\n\r\n"
            + "value2\r\n"
            + "--\(boundary)--\r\n"
        #expect(body == expected)
    }

    /// A file part's disposition carries `filename="…"` in addition to
    /// `name="…"`, taken from the last path component, and the file's bytes
    /// land verbatim rather than being re-encoded as text.
    @Test func multipartFilePartCarriesFilenameAndRawBytes() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("hakka-multipart-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let fileURL = dir.appendingPathComponent("upload.bin")
        let fileBytes = Data([0x00, 0xFF, 0x10, 0x9A])
        try fileBytes.write(to: fileURL)

        let part = MultipartPart(name: "upload", filePath: fileURL.path, contentType: "application/octet-stream")
        let encoded = try RequestBodyEncoder.encode(.multipart([part]))
        let data = try #require(encoded.data)

        #expect(data.range(of: Data("filename=\"upload.bin\"".utf8)) != nil)
        #expect(data.range(of: Data("Content-Type: application/octet-stream".utf8)) != nil)
        #expect(data.range(of: fileBytes) != nil)
    }

    // MARK: - Boundary collision guard

    @Test func boundaryCollidesDetectsSubstringAcrossContents() {
        #expect(RequestBodyEncoder.boundaryCollides("BOUND", in: [Data("hello BOUND world".utf8)]))
        #expect(!RequestBodyEncoder.boundaryCollides("BOUND", in: [Data("hello world".utf8)]))
    }

    /// A candidate that collides with existing content must be discarded and
    /// retried, not shipped anyway — this is the guard itself, exercised
    /// directly against a rigged candidate sequence so the test doesn't
    /// depend on ever actually winning the UUID lottery.
    @Test func chooseBoundaryRetriesPastACollidingCandidate() throws {
        var candidates = ["colliding", "safe"]
        let content = Data("...colliding...".utf8)
        let picked = try RequestBodyEncoder.chooseBoundary(avoiding: [content], candidates: { candidates.removeFirst() })
        #expect(picked == "safe")
    }

    @Test func chooseBoundaryGivesUpAfterMaxAttempts() {
        #expect(throws: RequestBodyEncodingError.self) {
            _ = try RequestBodyEncoder.chooseBoundary(avoiding: [Data("x".utf8)], candidates: { "x" }, maxAttempts: 3)
        }
    }
}
