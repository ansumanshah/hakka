import Foundation

/// Runs one OAuth2 grant to completion and hands back a token. An actor
/// because the authorization-code grant holds flow-local state (the PKCE
/// verifier, the `state` value, the loopback listener) across the
/// browser-launch/await-callback/exchange-token sequence, and that sequence
/// must not be interleaved with a second concurrent run reusing the same
/// runner.
///
/// Every side effect — the browser launch, the loopback wait, the token
/// HTTP call — goes through an injected seam (`OAuth2BrowserLaunching`,
/// `OAuth2LoopbackListening`, `OAuth2HTTPClient`). Tests supply fakes for
/// all three, so exercising state-mismatch handling, callback-error
/// surfacing, or the client-credentials/refresh grants never opens a socket
/// or a browser tab.
public actor OAuth2FlowRunner {
    let httpClient: OAuth2HTTPClient
    let browser: OAuth2BrowserLaunching
    let listener: OAuth2LoopbackListening
    let now: @Sendable () -> Date
    let callbackTimeout: TimeInterval

    public init(
        httpClient: OAuth2HTTPClient = URLSessionOAuth2HTTPClient(),
        browser: OAuth2BrowserLaunching = SystemBrowserLauncher(),
        listener: OAuth2LoopbackListening = NWLoopbackListener(),
        callbackTimeout: TimeInterval = 120,
        now: @escaping @Sendable () -> Date = { Date() },
    ) {
        self.httpClient = httpClient
        self.browser = browser
        self.listener = listener
        self.callbackTimeout = callbackTimeout
        self.now = now
    }

    /// Runs `grant` and returns the resulting token. `staticToken` (the
    /// legacy pasted-token shape) resolves immediately with no network
    /// call — there is no flow to run, only a value to wrap.
    public func run(_ grant: OAuth2Grant) async throws(OAuth2FlowError) -> OAuth2Token {
        switch grant {
        case let .clientCredentials(config):
            return try await runClientCredentials(config)
        case let .refreshToken(config):
            return try await runRefreshToken(config, refreshToken: config.refreshToken)
        case let .authorizationCode(config):
            return try await runAuthorizationCode(config)
        case let .staticToken(accessToken):
            return OAuth2Token(accessToken: accessToken)
        }
    }

    /// Ensures `current` is usable, refreshing it first if it is expired —
    /// this is the "before a request, not after a 401" contract: a caller
    /// checks this before building the request, so an expired token never
    /// goes out on the wire in the first place.
    public func ensureFresh(_ current: OAuth2Token, grant: OAuth2Grant) async throws(OAuth2FlowError) -> OAuth2Token {
        guard current.isExpired(now: now()) else { return current }
        guard let refreshToken = current.refreshToken else {
            throw .noRefreshTokenAvailable
        }
        switch grant {
        case let .clientCredentials(config):
            return try await runRefreshToken(
                RefreshTokenGrant(tokenURL: config.tokenURL, clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: refreshToken, scope: config.scope),
                refreshToken: refreshToken,
            )
        case let .refreshToken(config):
            return try await runRefreshToken(config, refreshToken: refreshToken)
        case let .authorizationCode(config):
            return try await runRefreshToken(
                RefreshTokenGrant(tokenURL: config.tokenURL, clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: refreshToken, scope: config.scope),
                refreshToken: refreshToken,
            )
        case .staticToken:
            // No token endpoint to call — a static token that reports itself
            // expired has nothing this runner can do about it.
            throw .noRefreshTokenAvailable
        }
    }

    func exchangeForToken(url: String, parameters: [String: String]) async throws(OAuth2FlowError) -> OAuth2Token {
        let issuedAt = now()
        let response: OAuth2TokenHTTPResponse
        do {
            response = try await httpClient.send(OAuth2TokenHTTPRequest(url: url, parameters: parameters))
        } catch let error as OAuth2FlowError {
            throw error
        } catch {
            throw .transport(error.localizedDescription)
        }
        let parsed = try OAuth2TokenEndpointResponse.parse(status: response.status, body: response.body)
        guard let accessToken = parsed.accessToken else { throw .malformedTokenResponse }
        return OAuth2Token(
            accessToken: accessToken,
            refreshToken: parsed.refreshToken,
            expiresAt: OAuth2Token.expiresAt(issuedAt: issuedAt, expiresIn: parsed.expiresIn),
        )
    }
}
