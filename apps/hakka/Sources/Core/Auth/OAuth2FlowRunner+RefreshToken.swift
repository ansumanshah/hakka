import Foundation

extension OAuth2FlowRunner {
    /// RFC 6749 §6: trades a refresh token for a fresh access token — the
    /// standalone "Refresh Token" grant a request can be configured with
    /// directly, and also the mechanism `ensureFresh` reaches for once a
    /// client-credentials or authorization-code token has expired.
    func runRefreshToken(_ config: RefreshTokenGrant, refreshToken: String) async throws(OAuth2FlowError) -> OAuth2Token {
        guard !refreshToken.isEmpty else { throw .noRefreshTokenAvailable }
        var parameters = [
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": config.clientId,
        ]
        if let clientSecret = config.clientSecret, !clientSecret.isEmpty {
            parameters["client_secret"] = clientSecret
        }
        if let scope = config.scope, !scope.isEmpty {
            parameters["scope"] = scope
        }
        let token = try await exchangeForToken(url: config.tokenURL, parameters: parameters)
        // Some servers omit `refresh_token` on a refresh response, meaning
        // "the one you sent is still valid" rather than "you no longer have
        // one" — fall back to the token that was just spent so a caller
        // storing the result doesn't lose its refresh capability.
        guard token.refreshToken == nil else { return token }
        return OAuth2Token(accessToken: token.accessToken, refreshToken: refreshToken, expiresAt: token.expiresAt)
    }
}
