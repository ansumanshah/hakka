import Foundation
import Testing
@testable import HakkaCore

// MARK: - Fakes (no network, no browser — the whole point of the seams)

private struct FakeHTTPClient: OAuth2HTTPClient {
    let handler: @Sendable (OAuth2TokenHTTPRequest) async throws -> OAuth2TokenHTTPResponse
    func send(_ request: OAuth2TokenHTTPRequest) async throws -> OAuth2TokenHTTPResponse {
        try await handler(request)
    }
}

private struct FakeBrowser: OAuth2BrowserLaunching {
    let handler: @Sendable (URL) async throws -> Void
    func open(_ url: URL) async throws { try await handler(url) }
}

private struct FakeListener: OAuth2LoopbackListening {
    let handler: @Sendable (Int, TimeInterval) async throws -> URL
    func awaitCallback(port: Int, timeout: TimeInterval) async throws -> URL {
        try await handler(port, timeout)
    }
}

private func jsonResponse(_ json: String, status: Int = 200) -> OAuth2TokenHTTPResponse {
    OAuth2TokenHTTPResponse(status: status, body: Data(json.utf8))
}

/// A lock-protected mutable slot for values a `@Sendable` fake closure
/// writes into and the test reads back — the fakes above may run on any
/// thread, so a plain captured `var` isn't safe under strict concurrency.
private final class Box<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) { self.value = value }

    func get() -> Value {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func set(_ newValue: Value) {
        lock.lock()
        defer { lock.unlock() }
        value = newValue
    }
}

// MARK: - Client credentials / refresh

@Suite("OAuth2FlowRunner — client credentials and refresh")
struct OAuth2FlowRunnerTokenGrantTests {
    @Test func clientCredentialsSendsGrantTypeAndReturnsToken() async throws {
        let http = FakeHTTPClient { request in
            #expect(request.parameters["grant_type"] == "client_credentials")
            #expect(request.parameters["client_id"] == "cid")
            #expect(request.parameters["client_secret"] == "csecret")
            return jsonResponse(#"{"access_token":"tok","expires_in":3600}"#)
        }
        let runner = OAuth2FlowRunner(httpClient: http, now: { Date(timeIntervalSince1970: 1000) })
        let token = try await runner.run(.clientCredentials(ClientCredentialsGrant(tokenURL: "https://x/token", clientId: "cid", clientSecret: "csecret")))
        #expect(token.accessToken == "tok")
        #expect(token.expiresAt == Date(timeIntervalSince1970: 1000 + 3600))
    }

    @Test func tokenEndpointErrorFieldIsSurfacedNotSwallowed() async throws {
        let http = FakeHTTPClient { _ in jsonResponse(#"{"error":"invalid_client","error_description":"bad secret"}"#) }
        let runner = OAuth2FlowRunner(httpClient: http)
        await #expect(throws: OAuth2FlowError.tokenEndpointError(code: "invalid_client", description: "bad secret")) {
            _ = try await runner.run(.clientCredentials(ClientCredentialsGrant(tokenURL: "https://x/token", clientId: "c", clientSecret: "s")))
        }
    }

    @Test func refreshGrantReusesTheStoredRefreshTokenWhenTheServerOmitsARotatedOne() async throws {
        let http = FakeHTTPClient { request in
            #expect(request.parameters["grant_type"] == "refresh_token")
            #expect(request.parameters["refresh_token"] == "seed-refresh")
            // No `refresh_token` in the response — the server is signalling
            // "the one you sent is still good," not "you have none now."
            return jsonResponse(#"{"access_token":"new-access"}"#)
        }
        let runner = OAuth2FlowRunner(httpClient: http)
        let token = try await runner.run(.refreshToken(RefreshTokenGrant(tokenURL: "https://x/token", clientId: "cid", refreshToken: "seed-refresh")))
        #expect(token.accessToken == "new-access")
        #expect(token.refreshToken == "seed-refresh")
    }

    @Test func refreshGrantWithNoRefreshTokenIsRejectedBeforeAnyRequest() async throws {
        let runner = OAuth2FlowRunner(httpClient: FakeHTTPClient { _ in Issue.record("must not call the network"); return jsonResponse("{}") })
        await #expect(throws: OAuth2FlowError.noRefreshTokenAvailable) {
            _ = try await runner.run(.refreshToken(RefreshTokenGrant(tokenURL: "https://x/token", clientId: "c", refreshToken: "")))
        }
    }

    @Test func ensureFreshLeavesAnUnexpiredTokenUntouched() async throws {
        let runner = OAuth2FlowRunner(
            httpClient: FakeHTTPClient { _ in Issue.record("must not refresh an unexpired token"); return jsonResponse("{}") },
            now: { Date(timeIntervalSince1970: 1000) },
        )
        let current = OAuth2Token(accessToken: "still-good", expiresAt: Date(timeIntervalSince1970: 5000))
        let result = try await runner.ensureFresh(current, grant: .clientCredentials(ClientCredentialsGrant(tokenURL: "https://x", clientId: "c", clientSecret: "s")))
        #expect(result == current)
    }

    @Test func ensureFreshRefreshesAnExpiredTokenBeforeItWouldBeUsed() async throws {
        let http = FakeHTTPClient { request in
            #expect(request.parameters["grant_type"] == "refresh_token")
            return jsonResponse(#"{"access_token":"refreshed","refresh_token":"rot"}"#)
        }
        let runner = OAuth2FlowRunner(httpClient: http, now: { Date(timeIntervalSince1970: 1000) })
        let current = OAuth2Token(accessToken: "stale", refreshToken: "seed", expiresAt: Date(timeIntervalSince1970: 500))
        let result = try await runner.ensureFresh(current, grant: .clientCredentials(ClientCredentialsGrant(tokenURL: "https://x/token", clientId: "c", clientSecret: "s")))
        #expect(result.accessToken == "refreshed")
        #expect(result.refreshToken == "rot")
    }
}

// MARK: - Authorization code + PKCE

@Suite("OAuth2FlowRunner — authorization code")
struct OAuth2FlowRunnerAuthorizationCodeTests {
    private func config(port: Int = 43117) -> AuthorizationCodeGrant {
        AuthorizationCodeGrant(
            authorizationURL: "https://idp.example.com/authorize",
            tokenURL: "https://idp.example.com/token",
            clientId: "cid",
            scope: "read",
            redirectPort: port,
        )
    }

    @Test func fullRunSendsTheVerifierThatMatchesTheChallengeItAdvertised() async throws {
        let capturedChallenge = Box<String?>(nil)
        let capturedVerifier = Box<String?>(nil)
        let capturedState = Box<String?>(nil)

        // `state` and the PKCE verifier/challenge are generated inside the
        // runner, so the fake browser records what it was actually asked to
        // open, and the fake listener echoes the state straight back — the
        // same round trip a real IdP redirect performs.
        let browser = FakeBrowser { url in
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let challengeMethod = items.first { $0.name == "code_challenge_method" }?.value
            capturedChallenge.set(items.first { $0.name == "code_challenge" }?.value)
            capturedState.set(items.first { $0.name == "state" }?.value)
            #expect(challengeMethod == "S256")
        }
        let listener = FakeListener { _, _ in
            URL(string: "http://127.0.0.1:43117/callback?code=authcode&state=\(capturedState.get() ?? "")")!
        }
        let http = FakeHTTPClient { request in
            capturedVerifier.set(request.parameters["code_verifier"])
            #expect(request.parameters["code"] == "authcode")
            #expect(request.parameters["grant_type"] == "authorization_code")
            return jsonResponse(#"{"access_token":"tok"}"#)
        }
        let runner = OAuth2FlowRunner(httpClient: http, browser: browser, listener: listener)

        let token = try await runner.run(.authorizationCode(config()))
        #expect(token.accessToken == "tok")
        #expect(capturedChallenge.get() != nil)
        #expect(capturedVerifier.get() != nil)
        #expect(PKCE.challenge(forVerifier: capturedVerifier.get()!) == capturedChallenge.get())
    }

    @Test func stateMismatchIsRejectedNotWarned() {
        let callback = URL(string: "http://127.0.0.1:43117/callback?code=authcode&state=wrong")!
        #expect(throws: OAuth2FlowError.stateMismatch) {
            _ = try OAuth2FlowRunner.authorizationCode(from: callback, expectedState: "expected")
        }
    }

    @Test func callbackErrorParameterIsSurfacedNotSwallowed() {
        let callback = URL(string: "http://127.0.0.1:43117/callback?error=access_denied&error_description=user%20said%20no&state=s")!
        #expect(throws: OAuth2FlowError.authorizationDenied(code: "access_denied", description: "user said no")) {
            _ = try OAuth2FlowRunner.authorizationCode(from: callback, expectedState: "s")
        }
    }

    @Test func missingCodeWithNoErrorIsRejected() {
        let callback = URL(string: "http://127.0.0.1:43117/callback?state=s")!
        #expect(throws: OAuth2FlowError.missingAuthorizationCode) {
            _ = try OAuth2FlowRunner.authorizationCode(from: callback, expectedState: "s")
        }
    }

    /// The fake listener stands in for "the port has already been
    /// released" — a real `NWLoopbackListener` cancels its `NWListener`
    /// before this throws (see `awaitCallback`'s doc comment); here what's
    /// under test is that the flow surfaces the timeout instead of hanging
    /// or retrying the listener.
    @Test func listenerTimeoutIsSurfacedAndTheFlowDoesNotRetry() async throws {
        let callCount = Box(0)
        let listener = FakeListener { _, _ in
            callCount.set(callCount.get() + 1)
            throw OAuth2FlowError.callbackTimedOut
        }
        let runner = OAuth2FlowRunner(browser: FakeBrowser { _ in }, listener: listener)
        await #expect(throws: OAuth2FlowError.callbackTimedOut) {
            _ = try await runner.run(.authorizationCode(config()))
        }
        #expect(callCount.get() == 1)
    }

    @Test func browserLaunchFailureNeverReachesTheListener() async throws {
        let listener = FakeListener { _, _ in
            Issue.record("must not wait for a callback when the browser never opened")
            throw OAuth2FlowError.callbackTimedOut
        }
        let runner = OAuth2FlowRunner(browser: FakeBrowser { _ in throw OAuth2FlowError.browserLaunchFailed }, listener: listener)
        await #expect(throws: OAuth2FlowError.browserLaunchFailed) {
            _ = try await runner.run(.authorizationCode(config()))
        }
    }
}

// MARK: - staticToken (legacy)

@Suite("OAuth2FlowRunner — static token")
struct OAuth2FlowRunnerStaticTokenTests {
    @Test func staticTokenResolvesWithoutAnyNetworkCall() async throws {
        let runner = OAuth2FlowRunner(httpClient: FakeHTTPClient { _ in Issue.record("must not touch the network"); return jsonResponse("{}") })
        let token = try await runner.run(.staticToken(accessToken: "pasted"))
        #expect(token.accessToken == "pasted")
    }
}
