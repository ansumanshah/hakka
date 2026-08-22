import Foundation
import HakkaCore
import Observation

/// Drives the Auth tab's "Get Token" button: runs the configured grant
/// through a real `OAuth2FlowRunner` (real browser, real loopback socket —
/// this type exists so a UI test never has to be the one holding that) and,
/// on success, writes the result into the collection's environment as
/// secret variables, then saves — obtained tokens must reach disk through
/// `EnvironmentStore`, never through the collection file `AuthSpec` lives in.
@MainActor
@Observable
final class OAuth2GetTokenModel {
    private(set) var isRunning = false
    private(set) var lastError: String?
    private(set) var lastObtainedAt: Date?
    /// The obtained token's expiry, for the Auth tab's countdown — `nil`
    /// when the provider omitted `expires_in` (RFC 6749 makes it optional),
    /// in which case the token is treated as never expiring, same as
    /// `OAuth2Token.isExpired`.
    private(set) var lastExpiresAt: Date?

    private let runner = OAuth2FlowRunner()

    func run(config: OAuth2Config, environment: EnvironmentModel, collectionDirectory: URL?) async {
        isRunning = true
        lastError = nil
        defer { isRunning = false }

        do {
            let token = try await runner.run(config.grant)
            store(token, config: config, environment: environment)
            lastObtainedAt = Date()
            lastExpiresAt = token.expiresAt
            if let collectionDirectory {
                await environment.save(forCollectionAt: collectionDirectory)
            }
        } catch {
            lastError = Self.message(for: error)
        }
    }

    private func store(_ token: OAuth2Token, config: OAuth2Config, environment: EnvironmentModel) {
        guard var target = environment.selected else { return }
        target.variables = Self.upsert(target.variables, name: config.accessTokenVariable, value: token.accessToken)
        if let variable = config.refreshTokenVariable, let refreshToken = token.refreshToken {
            target.variables = Self.upsert(target.variables, name: variable, value: refreshToken)
        }
        if let variable = config.expiresAtVariable, let expiresAt = token.expiresAt {
            target.variables = Self.upsert(target.variables, name: variable, value: ISO8601DateFormatter().string(from: expiresAt))
        }
        environment.update(target)
    }

    private static func upsert(_ variables: [EnvironmentVariable], name: String, value: String) -> [EnvironmentVariable] {
        var variables = variables
        if let index = variables.firstIndex(where: { $0.name == name }) {
            variables[index].value = value
            variables[index].secret = true
        } else {
            variables.append(EnvironmentVariable(name: name, value: value, secret: true))
        }
        return variables
    }

    private static func message(for error: OAuth2FlowError) -> String {
        switch error {
        case .browserLaunchFailed: "Couldn't open the system browser."
        case .callbackTimedOut: "Timed out waiting for the browser redirect."
        case .cancelled: "Sign-in was cancelled."
        case let .authorizationDenied(code, description): "Authorization denied: \(description ?? code)"
        case .stateMismatch: "The redirect's state didn't match — rejected."
        case .missingAuthorizationCode: "The redirect had no authorization code."
        case let .tokenEndpointHTTPError(status, _): "Token endpoint returned HTTP \(status)."
        case let .tokenEndpointError(code, description): "Token endpoint error: \(description ?? code)"
        case .malformedTokenResponse: "Token endpoint response wasn't valid."
        case .noRefreshTokenAvailable: "No refresh token is available to renew this."
        case let .transport(message): message
        }
    }
}
