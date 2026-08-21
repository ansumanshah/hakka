import HakkaCore

/// UI-facing mirror of `OAuth2Grant`'s cases, without the associated
/// values — what the grant-type picker inside the OAuth2 auth section
/// binds to. `.staticToken` is deliberately absent: it's a decode-only
/// compatibility shape for pre-1.3 files, never offered for new configuration.
enum OAuth2GrantKind: String, CaseIterable, Identifiable {
    case clientCredentials = "Client Credentials"
    case refreshToken = "Refresh Token"
    case authorizationCode = "Authorization Code (PKCE)"

    var id: String { rawValue }

    init(_ grant: OAuth2Grant) {
        switch grant {
        case .clientCredentials: self = .clientCredentials
        case .refreshToken: self = .refreshToken
        case .authorizationCode: self = .authorizationCode
        case .staticToken: self = .authorizationCode
        }
    }

    func makeDefault() -> OAuth2Grant {
        switch self {
        case .clientCredentials: .clientCredentials(ClientCredentialsGrant())
        case .refreshToken: .refreshToken(RefreshTokenGrant())
        case .authorizationCode: .authorizationCode(AuthorizationCodeGrant())
        }
    }
}
