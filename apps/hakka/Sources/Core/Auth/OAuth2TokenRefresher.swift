import Foundation

/// Reads whatever OAuth2 token currently lives in a `VariableScope`, and
/// refreshes it through an `OAuth2FlowRunner` if it's expired — the "before
/// a request, not after a 401" half of the requirement. `RequestEditorModel`
/// calls this once, right before `RequestResolver.resolve`, so the token
/// `.oauth2`'s `{{accessTokenVariable}}` interpolates to is already fresh.
public enum OAuth2TokenRefresher {
    /// Does nothing for any non-`.oauth2` auth, and for a `.staticToken`
    /// grant (nothing to refresh). For every other grant: if the token
    /// currently in `scope` is missing or expired, this is a no-op (no seed
    /// token means the user hasn't run the flow yet — that's a UI action,
    /// not something a send silently triggers); if a token exists and is
    /// expired, this refreshes it and writes the result back into `scope`.
    public static func refreshIfNeeded(
        auth: AuthSpec,
        scope: VariableScope,
        runner: OAuth2FlowRunner,
    ) async -> VariableScope {
        guard case let .oauth2(config) = auth, case .staticToken = config.grant else { return scope }
        guard let current = currentToken(config: config, scope: scope), current.isExpired() else {
            return scope
        }
        guard let refreshed = try? await runner.ensureFresh(current, grant: config.grant) else {
            return scope
        }
        return apply(refreshed, config: config, to: scope)
    }

    static func currentToken(config: OAuth2Config, scope: VariableScope) -> OAuth2Token? {
        guard let accessToken = scope.value(for: config.accessTokenVariable), !accessToken.isEmpty else {
            return nil
        }
        let refreshToken = config.refreshTokenVariable.flatMap { scope.value(for: $0) }
        let expiresAt = config.expiresAtVariable
            .flatMap { scope.value(for: $0) }
            .flatMap { ISO8601DateFormatter().date(from: $0) }
        return OAuth2Token(accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt)
    }

    static func apply(_ token: OAuth2Token, config: OAuth2Config, to scope: VariableScope) -> VariableScope {
        var scope = scope
        scope.setRuntime(config.accessTokenVariable, token.accessToken)
        if let refreshTokenVariable = config.refreshTokenVariable, let refreshToken = token.refreshToken {
            scope.setRuntime(refreshTokenVariable, refreshToken)
        }
        if let expiresAtVariable = config.expiresAtVariable, let expiresAt = token.expiresAt {
            scope.setRuntime(expiresAtVariable, ISO8601DateFormatter().string(from: expiresAt))
        }
        return scope
    }
}
