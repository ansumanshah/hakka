import HakkaCore
import SwiftUI

/// The OAuth2 case of the Auth tab: grant-type picker, that grant's fields,
/// and a "Get Token" button that runs the real flow (system browser +
/// loopback listener) and stores the result as a secret environment
/// variable — never in the request the picker is editing.
struct OAuth2AuthSectionView: View {
    @Binding var spec: RequestSpec
    @Environment(AppModel.self) private var model
    @State private var getToken = OAuth2GetTokenModel()

    private var authTab: RequestAuthTabView { RequestAuthTabView(spec: $spec) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Picker("Grant", selection: authTab.oauth2GrantKindBinding) {
                ForEach(OAuth2GrantKind.allCases) { Text($0.rawValue).tag($0) }
            }
            .frame(maxWidth: 260)

            grantFields

            LabeledField("Access Token Variable", text: authTab.oauth2AccessTokenVariableBinding)

            tokenActionRow
            if isAuthorizationCodeGrant {
                browserFootnote
            }
        }
    }

    @ViewBuilder
    private var grantFields: some View {
        switch authTab.oauth2Config.grant {
        case .clientCredentials:
            ClientCredentialsFields(authTab: authTab)
        case .refreshToken:
            RefreshTokenFields(authTab: authTab)
        case .authorizationCode:
            AuthorizationCodeFields(authTab: authTab)
        case .staticToken:
            EmptyView()
        }
    }

    /// Get Token, then — once a token exists — the trust block beside it:
    /// the expiry countdown, the storage note, and a Refresh button that
    /// re-runs the same grant.
    private var tokenActionRow: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            getTokenButton
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                statusText
                if getToken.lastObtainedAt != nil {
                    storageNote
                }
            }
            Spacer()
            if getToken.lastObtainedAt != nil {
                refreshButton
            }
        }
    }

    private var getTokenButton: some View {
        Button(getToken.isRunning ? "Getting Token…" : "Get Token") {
            Task { await getToken.run(config: authTab.oauth2Config, environment: model.environment, collectionDirectory: model.collection.directoryURL) }
        }
        .disabled(getToken.isRunning)
    }

    private var refreshButton: some View {
        Button("Refresh") {
            Task { await getToken.run(config: authTab.oauth2Config, environment: model.environment, collectionDirectory: model.collection.directoryURL) }
        }
        .disabled(getToken.isRunning)
    }

    @ViewBuilder
    private var statusText: some View {
        if let error = getToken.lastError {
            Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red).font(.caption)
        } else if getToken.lastObtainedAt != nil {
            TimelineView(.periodic(from: .now, by: 30)) { context in
                Label(tokenAcquiredText(now: context.date), systemImage: "checkmark.circle")
                    .foregroundStyle(.green)
                    .font(.caption)
            }
        }
    }

    private func tokenAcquiredText(now: Date) -> String {
        guard let expiresAt = getToken.lastExpiresAt else { return "Token acquired" }
        return "Token acquired · \(OAuth2ExpiryCountdown(expiresAt: expiresAt, now: now).displayText)"
    }

    /// Verified true in `OAuth2GetTokenModel.store`: the token is written
    /// only to `EnvironmentModel`/`EnvironmentStore`, never into `spec.auth`
    /// or the collection file that lives in.
    private var storageNote: some View {
        Text("stored as {{\(authTab.oauth2Config.accessTokenVariable)}} in \(environmentName) · never written to the collection")
            .font(.caption2.monospaced())
            .foregroundStyle(.tertiary)
    }

    private var environmentName: String {
        model.environment.selected?.name ?? "the active environment"
    }

    private var isAuthorizationCodeGrant: Bool {
        if case .authorizationCode = authTab.oauth2Config.grant { true } else { false }
    }

    /// Only the authorization-code grant opens a system browser
    /// (`OAuth2FlowRunner.runAuthorizationCode`) — client-credentials and
    /// refresh-token grants POST directly to the token endpoint with no
    /// browser involved, so this footnote would misdescribe those.
    private var browserFootnote: some View {
        Label("Opens your real browser. Hakka never sees your password.", systemImage: "arrow.up.forward.app")
            .font(.caption2)
            .foregroundStyle(.tertiary)
    }
}

private struct ClientCredentialsFields: View {
    let authTab: RequestAuthTabView

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            LabeledField("Token URL", text: authTab.clientCredentialsBinding(\.tokenURL))
            LabeledField("Client ID", text: authTab.clientCredentialsBinding(\.clientId))
            LabeledField("Client Secret", text: authTab.clientCredentialsBinding(\.clientSecret), secure: true)
            LabeledField("Scope", text: authTab.clientCredentialsBinding(\.scope).nonOptional)
        }
    }
}

private struct RefreshTokenFields: View {
    let authTab: RequestAuthTabView

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            LabeledField("Token URL", text: authTab.refreshTokenBinding(\.tokenURL))
            LabeledField("Client ID", text: authTab.refreshTokenBinding(\.clientId))
            LabeledField("Client Secret", text: authTab.refreshTokenBinding(\.clientSecret).nonOptional, secure: true)
            LabeledField("Refresh Token", text: authTab.refreshTokenBinding(\.refreshToken), secure: true)
        }
    }
}

private struct AuthorizationCodeFields: View {
    let authTab: RequestAuthTabView

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            LabeledField("Authorization URL", text: authTab.authorizationCodeBinding(\.authorizationURL))
            LabeledField("Token URL", text: authTab.authorizationCodeBinding(\.tokenURL))
            LabeledField("Client ID", text: authTab.authorizationCodeBinding(\.clientId))
            LabeledField("Client Secret (optional)", text: authTab.authorizationCodeBinding(\.clientSecret).nonOptional, secure: true)
            LabeledField("Scope", text: authTab.authorizationCodeBinding(\.scope).nonOptional)
            LabeledField("Redirect Port", text: authTab.authorizationCodeBinding(\.redirectPort).stringified)
        }
    }
}
