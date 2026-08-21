import HakkaCore
import SwiftUI

/// One `Binding` per `OAuth2Config`/`OAuth2Grant` field, split out for the
/// same reason `RequestAuthTabView+Bindings.swift` is: a view body that's
/// all layout, not a wall of get/set closures.
extension RequestAuthTabView {
    var oauth2Config: OAuth2Config {
        if case let .oauth2(config) = spec.auth { config } else { OAuth2Config(grant: .authorizationCode(AuthorizationCodeGrant())) }
    }

    func setOAuth2Config(_ config: OAuth2Config) {
        spec.auth = .oauth2(config)
    }

    var oauth2GrantKindBinding: Binding<OAuth2GrantKind> {
        Binding(
            get: { OAuth2GrantKind(oauth2Config.grant) },
            set: { var config = oauth2Config; config.grant = $0.makeDefault(); setOAuth2Config(config) },
        )
    }

    var oauth2AccessTokenVariableBinding: Binding<String> {
        Binding(
            get: { oauth2Config.accessTokenVariable },
            set: { var config = oauth2Config; config.accessTokenVariable = $0; setOAuth2Config(config) },
        )
    }

    // MARK: - Client credentials

    func clientCredentialsBinding<Value>(_ keyPath: WritableKeyPath<ClientCredentialsGrant, Value>) -> Binding<Value> {
        Binding(
            get: { if case let .clientCredentials(grant) = oauth2Config.grant { grant[keyPath: keyPath] } else { ClientCredentialsGrant()[keyPath: keyPath] } },
            set: { newValue in
                guard case var .clientCredentials(grant) = oauth2Config.grant else { return }
                grant[keyPath: keyPath] = newValue
                var config = oauth2Config
                config.grant = .clientCredentials(grant)
                setOAuth2Config(config)
            },
        )
    }

    // MARK: - Refresh token

    func refreshTokenBinding<Value>(_ keyPath: WritableKeyPath<RefreshTokenGrant, Value>) -> Binding<Value> {
        Binding(
            get: { if case let .refreshToken(grant) = oauth2Config.grant { grant[keyPath: keyPath] } else { RefreshTokenGrant()[keyPath: keyPath] } },
            set: { newValue in
                guard case var .refreshToken(grant) = oauth2Config.grant else { return }
                grant[keyPath: keyPath] = newValue
                var config = oauth2Config
                config.grant = .refreshToken(grant)
                setOAuth2Config(config)
            },
        )
    }

    // MARK: - Authorization code

    func authorizationCodeBinding<Value>(_ keyPath: WritableKeyPath<AuthorizationCodeGrant, Value>) -> Binding<Value> {
        Binding(
            get: { if case let .authorizationCode(grant) = oauth2Config.grant { grant[keyPath: keyPath] } else { AuthorizationCodeGrant()[keyPath: keyPath] } },
            set: { newValue in
                guard case var .authorizationCode(grant) = oauth2Config.grant else { return }
                grant[keyPath: keyPath] = newValue
                var config = oauth2Config
                config.grant = .authorizationCode(grant)
                setOAuth2Config(config)
            },
        )
    }
}
