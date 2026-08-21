import Foundation

extension OAuth2FlowRunner {
    /// RFC 6749 §4.1 + RFC 7636: open the system browser at the
    /// authorization endpoint, wait on the loopback listener for the
    /// redirect, verify `state`, then exchange the code (plus the PKCE
    /// verifier) for a token. The verifier and `state` are generated fresh
    /// for every call — never reused across runs.
    func runAuthorizationCode(_ config: AuthorizationCodeGrant) async throws(OAuth2FlowError) -> OAuth2Token {
        let verifier = PKCE.generateVerifier()
        let challenge = PKCE.challenge(forVerifier: verifier)
        let state = SecureRandom.token()

        guard let authorizationURL = URL(string: Self.buildAuthorizationURL(config, challenge: challenge, state: state)) else {
            throw .transport("invalid authorization URL")
        }

        do {
            try await browser.open(authorizationURL)
        } catch let error as OAuth2FlowError {
            throw error
        } catch {
            throw .browserLaunchFailed
        }

        let callbackURL: URL
        do {
            callbackURL = try await listener.awaitCallback(port: config.redirectPort, timeout: callbackTimeout)
        } catch let error as OAuth2FlowError {
            throw error
        } catch {
            throw .transport(error.localizedDescription)
        }

        let code = try Self.authorizationCode(from: callbackURL, expectedState: state)

        var parameters = [
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": config.redirectURI,
            "client_id": config.clientId,
            "code_verifier": verifier,
        ]
        if let clientSecret = config.clientSecret, !clientSecret.isEmpty {
            parameters["client_secret"] = clientSecret
        }
        return try await exchangeForToken(url: config.tokenURL, parameters: parameters)
    }

    static func buildAuthorizationURL(_ config: AuthorizationCodeGrant, challenge: String, state: String) -> String {
        var items: [(name: String, value: String)] = [
            ("response_type", "code"),
            ("client_id", config.clientId),
            ("redirect_uri", config.redirectURI),
            ("state", state),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
        ]
        if let scope = config.scope, !scope.isEmpty {
            items.append(("scope", scope))
        }
        let (base, existing) = URLQuerySplitter.split(config.authorizationURL)
        return URLQuerySplitter.join(base: base, items: existing + items)
    }

    /// Validates the redirect before trusting anything in it: an `error`
    /// parameter is surfaced verbatim (never swallowed into a generic
    /// failure), and a `state` that doesn't match what this run generated
    /// is rejected outright — that mismatch is exactly the cross-site
    /// request forgery `state` exists to catch.
    static func authorizationCode(from callbackURL: URL, expectedState: String) throws(OAuth2FlowError) -> String {
        let (_, items) = URLQuerySplitter.split(callbackURL.absoluteString)
        func value(_ name: String) -> String? {
            items.first { $0.name == name }?.value
        }

        if let error = value("error") {
            throw .authorizationDenied(code: error, description: value("error_description"))
        }
        guard let state = value("state"), state == expectedState else {
            throw .stateMismatch
        }
        guard let code = value("code"), !code.isEmpty else {
            throw .missingAuthorizationCode
        }
        return code
    }
}
