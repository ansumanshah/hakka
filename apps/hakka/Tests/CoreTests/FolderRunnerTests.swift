import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

// MARK: - Fixtures

private struct StubTransport: RequestTransport {
    let handler: @Sendable (URLRequest, Bool) async throws -> TransportResponse

    func execute(_ request: URLRequest, followRedirects: Bool) async throws -> TransportResponse {
        try await handler(request, followRedirects)
    }
}

/// Collects header values across concurrent transport calls without a data
/// race — an actor rather than a plain `var` since `StubTransport.execute`
/// can be invoked from `FolderRunner`'s isolation.
private actor ReceivedHeaders {
    private(set) var last: String?
    func record(_ value: String?) { last = value }
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

@Suite("FolderRunner")
struct FolderRunnerTests {
    private func collection() -> Collection { Collection(name: "C") }

    /// The behaviour a folder run exists for: a value captured by the
    /// *first* request in the folder must reach a request two levels
    /// further down the run, not just the request immediately after it —
    /// proves the scope is threaded across the whole sequence, not just
    /// handed from each request to its direct successor by coincidence.
    @Test func capturedValueReachesThirdRequest() async throws {
        let runner = FolderRunner(transport: StubTransport { request, _ in
            if request.url?.path == "/login" {
                return jsonResponse(#"{"token":"secret-token"}"#)
            }
            return jsonResponse("{}")
        })

        let login = RequestSpec(
            name: "Login",
            url: "https://api.example.com/login",
            captures: [ResponseCapture(variable: "authToken", source: .jsonPath("token"))],
        )
        let unrelated = RequestSpec(name: "Ping", url: "https://api.example.com/ping")
        let whoAmI = RequestSpec(
            name: "WhoAmI",
            url: "https://api.example.com/me",
            headers: [HeaderPair(name: "Authorization", value: "Bearer {{authToken}}")],
        )

        let folder = Folder(name: "Auth Flow", children: [.request(login), .request(unrelated), .request(whoAmI)])
        let summary = try #require(await runner.run(folder, collection: collection(), scope: VariableScope()))

        #expect(summary.items.map(\.name) == ["Login", "Ping", "WhoAmI"])
        #expect(summary.items.allSatisfy { $0.status == .passed })
        #expect(summary.finalScope.value(for: "authToken") == "secret-token")

        // Re-run the third request's resolve directly against the run's
        // final scope to confirm the header actually carried the captured
        // value — the summary alone doesn't expose sent headers.
        let resolved = try RequestResolver.resolve(whoAmI, collection: collection(), scope: summary.finalScope)
        #expect(resolved.headers["Authorization"] == "Bearer secret-token")
    }

    /// A request that fails mid-run must not stop later requests from
    /// running — the documented "continue" failure mode.
    @Test func midRunFailureDoesNotStopLaterRequests() async throws {
        struct NetworkFailure: Error {}
        let runner = FolderRunner(transport: StubTransport { request, _ in
            if request.url?.path == "/broken" { throw NetworkFailure() }
            return jsonResponse("{}")
        })

        let first = RequestSpec(name: "First", url: "https://api.example.com/first")
        let broken = RequestSpec(name: "Broken", url: "https://api.example.com/broken")
        let last = RequestSpec(name: "Last", url: "https://api.example.com/last")
        let folder = Folder(name: "Smoke", children: [.request(first), .request(broken), .request(last)])

        let summary = try #require(await runner.run(folder, collection: collection(), scope: VariableScope()))

        #expect(summary.items.map(\.name) == ["First", "Broken", "Last"])
        #expect(summary.items[0].status == .passed)
        #expect(summary.items[1].status.isFailure)
        // The critical assertion: the run did not stop at "Broken" — "Last"
        // was attempted and recorded too.
        #expect(summary.items[2].status == .passed)
        #expect(summary.failedCount == 1)
        #expect(summary.passedCount == 2)
    }

    /// A request whose variables never resolve is reported as a distinct
    /// failure kind (never reached the wire) without halting the run.
    @Test func resolutionFailureIsReportedAndRunContinues() async throws {
        let runner = FolderRunner(transport: StubTransport { _, _ in jsonResponse("{}") })

        let missingVar = RequestSpec(name: "Needs Var", url: "https://api.example.com/{{missing}}")
        let after = RequestSpec(name: "After", url: "https://api.example.com/after")
        let folder = Folder(name: "F", children: [.request(missingVar), .request(after)])

        let summary = try #require(await runner.run(folder, collection: collection(), scope: VariableScope()))

        #expect(summary.items[0].durationMs == nil)
        guard case .resolutionFailed = summary.items[0].status else {
            Issue.record("expected resolutionFailed, got \(summary.items[0].status)")
            return
        }
        #expect(summary.items[1].status == .passed)
    }

    /// An empty folder run must not produce a summary that reads as a
    /// vacuous "0 passed, 0 failed" success.
    @Test func emptyFolderProducesNoSummary() async {
        let runner = FolderRunner(transport: StubTransport { _, _ in jsonResponse("{}") })
        let emptyFolder = Folder(name: "Empty")
        let summary = await runner.run(emptyFolder, collection: collection(), scope: VariableScope())
        #expect(summary == nil)
    }

    /// A folder containing only an empty subfolder is still empty overall.
    @Test func emptyFolderWithOnlyEmptySubfoldersProducesNoSummary() async {
        let runner = FolderRunner(transport: StubTransport { _, _ in jsonResponse("{}") })
        let nested = Folder(name: "Outer", children: [.folder(Folder(name: "Inner"))])
        let summary = await runner.run(nested, collection: collection(), scope: VariableScope())
        #expect(summary == nil)
    }

    /// Nested subfolder requests run depth-first, at the point their
    /// subfolder appears among its siblings — not skipped, not deferred to
    /// the end.
    @Test func nestedSubfolderRequestsRunDepthFirstInDeclaredOrder() async throws {
        let runner = FolderRunner(transport: StubTransport { _, _ in jsonResponse("{}") })

        let inner = Folder(name: "Inner", children: [.request(RequestSpec(name: "Inner Request", url: "https://api.example.com/inner"))])
        let outer = Folder(
            name: "Outer",
            children: [
                .request(RequestSpec(name: "Before", url: "https://api.example.com/before")),
                .folder(inner),
                .request(RequestSpec(name: "After", url: "https://api.example.com/after")),
            ],
        )

        let summary = try #require(await runner.run(outer, collection: collection(), scope: VariableScope()))
        #expect(summary.items.map(\.name) == ["Before", "Inner Request", "After"])
    }

    /// Cookies set by one request in the run must be carried by a later
    /// request in the same run — the shared-jar behaviour: one `CookieJar`
    /// backs every request in a `FolderRunner.run` call.
    @Test func cookieSetByOneRequestCarriesToALaterRequestInTheSameRun() async throws {
        let receivedCookieHeaders = ReceivedHeaders()
        let runner = FolderRunner(transport: StubTransport { request, _ in
            if request.url?.path == "/set" {
                return jsonResponse("{}", headers: ["Set-Cookie": "session=abc123; Path=/"])
            }
            await receivedCookieHeaders.record(request.value(forHTTPHeaderField: "Cookie"))
            return jsonResponse("{}")
        })

        let setter = RequestSpec(name: "Set Cookie", url: "https://api.example.com/set")
        let reader = RequestSpec(name: "Read Cookie", url: "https://api.example.com/read")
        let folder = Folder(name: "F", children: [.request(setter), .request(reader)])

        let summary = try #require(await runner.run(folder, collection: collection(), scope: VariableScope()))
        #expect(summary.items.allSatisfy { $0.status == .passed })
        let cookieHeader = await receivedCookieHeaders.last
        #expect(cookieHeader?.contains("session=abc123") == true)
    }
}
