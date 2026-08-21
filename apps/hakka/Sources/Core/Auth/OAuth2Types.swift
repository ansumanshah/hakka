import Foundation

/// The grant this OAuth2 auth entry runs. Each case carries exactly the
/// fields that grant's token request needs — no shared "everything" struct,
/// so a client-credentials request can't accidentally reference a redirect
/// port it will never use.
public enum OAuth2Grant: Sendable, Codable, Equatable {
    case clientCredentials(ClientCredentialsGrant)
    case refreshToken(RefreshTokenGrant)
    case authorizationCode(AuthorizationCodeGrant)
    /// A single pre-obtained token, no flow run. This is the shape the
    /// pre-1.3 `AuthSpec.oauth2(accessToken:)` case modeled — kept only so a
    /// collection file written by that build still decodes; the auth tab no
    /// longer offers it for new configuration.
    case staticToken(accessToken: String)
}

public struct ClientCredentialsGrant: Sendable, Codable, Equatable {
    public var tokenURL: String
    public var clientId: String
    public var clientSecret: String
    public var scope: String?

    public init(tokenURL: String = "", clientId: String = "", clientSecret: String = "", scope: String? = nil) {
        self.tokenURL = tokenURL
        self.clientId = clientId
        self.clientSecret = clientSecret
        self.scope = scope
    }
}

public struct RefreshTokenGrant: Sendable, Codable, Equatable {
    public var tokenURL: String
    public var clientId: String
    public var clientSecret: String?
    /// The seed refresh token, typed in once. After the first successful
    /// refresh the *current* refresh token (which a compliant server may
    /// rotate) lives in the environment under `refreshTokenVariable`, not
    /// here — this field only bootstraps the very first request.
    public var refreshToken: String
    public var scope: String?

    public init(
        tokenURL: String = "",
        clientId: String = "",
        clientSecret: String? = nil,
        refreshToken: String = "",
        scope: String? = nil,
    ) {
        self.tokenURL = tokenURL
        self.clientId = clientId
        self.clientSecret = clientSecret
        self.refreshToken = refreshToken
        self.scope = scope
    }
}

public struct AuthorizationCodeGrant: Sendable, Codable, Equatable {
    public var authorizationURL: String
    public var tokenURL: String
    public var clientId: String
    /// Public clients (SPAs, native apps) leave this empty and rely on PKCE
    /// alone, which is the whole point of PKCE — the field stays for the
    /// confidential-client case some APIs still require alongside it.
    public var clientSecret: String?
    public var scope: String?
    /// The loopback port Hakka listens on for the redirect. Fixed per
    /// request rather than picked at random each run so the same
    /// `redirect_uri` can be registered with the provider ahead of time.
    public var redirectPort: Int

    public init(
        authorizationURL: String = "",
        tokenURL: String = "",
        clientId: String = "",
        clientSecret: String? = nil,
        scope: String? = nil,
        redirectPort: Int = 43117,
    ) {
        self.authorizationURL = authorizationURL
        self.tokenURL = tokenURL
        self.clientId = clientId
        self.clientSecret = clientSecret
        self.scope = scope
        self.redirectPort = redirectPort
    }

    public var redirectURI: String { "http://127.0.0.1:\(redirectPort)/callback" }
}

/// An OAuth2 auth entry: which grant to run, and which environment
/// variables the obtained token lands in. The variables — not a literal
/// token — are what `EffectiveRequest`/`RequestResolver` interpolate into
/// the `Authorization` header, so the access token itself never sits in the
/// `.hakka` file this config is part of.
public struct OAuth2Config: Sendable, Codable, Equatable {
    public var grant: OAuth2Grant
    public var accessTokenVariable: String
    public var refreshTokenVariable: String?
    /// ISO-8601 instant, stored as a plain string variable like every other
    /// environment value.
    public var expiresAtVariable: String?

    public init(
        grant: OAuth2Grant,
        accessTokenVariable: String = "oauth2_access_token",
        refreshTokenVariable: String? = "oauth2_refresh_token",
        expiresAtVariable: String? = "oauth2_expires_at",
    ) {
        self.grant = grant
        self.accessTokenVariable = accessTokenVariable
        self.refreshTokenVariable = refreshTokenVariable
        self.expiresAtVariable = expiresAtVariable
    }

    private enum CodingKeys: String, CodingKey {
        case grant, accessTokenVariable, refreshTokenVariable, expiresAtVariable
    }

    /// Only present in a pre-1.3 file, where `oauth2`'s whole payload was
    /// `{"accessToken": "..."}` — no `grant` key at all. A separate key type
    /// (rather than an extra `CodingKeys` case) because `CodingKeys` also
    /// drives the synthesized `encode(to:)`, which must only ever see the
    /// current shape's keys.
    private enum LegacyCodingKeys: String, CodingKey {
        case accessToken
    }

    /// Reads either shape: a file with a `grant` key decodes normally; a
    /// file with only `accessToken` (format version 1) is upgraded in place
    /// to `.staticToken`, so opening an old collection never fails and never
    /// silently drops the credential.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let grant = try container.decodeIfPresent(OAuth2Grant.self, forKey: .grant) {
            self.grant = grant
        } else {
            let legacyContainer = try decoder.container(keyedBy: LegacyCodingKeys.self)
            let legacyToken = try legacyContainer.decode(String.self, forKey: .accessToken)
            grant = .staticToken(accessToken: legacyToken)
        }
        accessTokenVariable = try container.decodeIfPresent(String.self, forKey: .accessTokenVariable) ?? "oauth2_access_token"
        refreshTokenVariable = try container.decodeIfPresent(String.self, forKey: .refreshTokenVariable)
        expiresAtVariable = try container.decodeIfPresent(String.self, forKey: .expiresAtVariable)
    }
}
