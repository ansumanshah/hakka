import Foundation
import HakkaCommon

/// Auth precedence and header/query injection, split out of
/// `RequestResolver.swift` to keep that file under the line cap.
extension RequestResolver {
    /// Auth precedence walks the opposite direction from headers: the
    /// nearest non-`.inherit` `AuthSpec` starting at the request and going
    /// *up* through the folder chain to the collection wins, since
    /// `.inherit` means "keep asking my parent."
    ///
    /// Not `private`: `RequestEditorModel.send` needs to know which
    /// `AuthSpec` a request will actually run under, before resolving, to
    /// check whether an OAuth2 token needs a pre-send refresh.
    public static func effectiveAuth(request: AuthSpec, folderChain: [Folder], collectionAuth: AuthSpec) -> AuthSpec {
        if case .inherit = request {} else { return request }
        for folder in folderChain.reversed() {
            if case .inherit = folder.auth {} else { return folder.auth }
        }
        if case .inherit = collectionAuth { return .none }
        return collectionAuth
    }

    static func applyAuth(
        _ auth: AuthSpec,
        headers: inout HeaderList,
        query: inout [(name: String, value: String)],
        scope: VariableScope,
        missing: inout [String],
    ) {
        switch auth {
        case .inherit, .none:
            return
        case let .basic(username, password):
            let user = interpolate(username, scope: scope, missing: &missing)
            let pass = interpolate(password, scope: scope, missing: &missing)
            let token = Data("\(user):\(pass)".utf8).base64EncodedString()
            setHeader("Authorization", "Basic \(token)", in: &headers)
        case let .bearer(token):
            setHeader("Authorization", "Bearer \(interpolate(token, scope: scope, missing: &missing))", in: &headers)
        case let .oauth2(config):
            // The obtained token never lives in the spec — `OAuth2TokenRefresher`
            // (called before this resolve, see `RequestEditorModel.send`)
            // writes it into `scope`'s runtime layer under
            // `accessTokenVariable`, and this interpolates it exactly like a
            // hand-typed `{{var}}` bearer token would.
            let template = "{{\(config.accessTokenVariable)}}"
            let literal = if case let .staticToken(accessToken) = config.grant { accessToken } else { template }
            setHeader("Authorization", "Bearer \(interpolate(literal, scope: scope, missing: &missing))", in: &headers)
        case let .apiKey(name, value, placement):
            let resolvedName = interpolate(name, scope: scope, missing: &missing)
            let resolvedValue = interpolate(value, scope: scope, missing: &missing)
            switch placement {
            case .header: setHeader(resolvedName, resolvedValue, in: &headers)
            case .query: setQuery(resolvedName, resolvedValue, in: &query)
            }
        }
    }
}
