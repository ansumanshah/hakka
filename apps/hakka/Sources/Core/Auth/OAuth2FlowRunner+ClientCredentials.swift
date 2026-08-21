import Foundation

extension OAuth2FlowRunner {
    /// RFC 6749 §4.4: a direct, two-legged token request — client id/secret
    /// in, access token out, no browser and no user interaction.
    func runClientCredentials(_ config: ClientCredentialsGrant) async throws(OAuth2FlowError) -> OAuth2Token {
        var parameters = [
            "grant_type": "client_credentials",
            "client_id": config.clientId,
            "client_secret": config.clientSecret,
        ]
        if let scope = config.scope, !scope.isEmpty {
            parameters["scope"] = scope
        }
        return try await exchangeForToken(url: config.tokenURL, parameters: parameters)
    }
}
