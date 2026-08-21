import Foundation
import HakkaCommon

/// A `RequestSpec` flattened into what actually gets sent — auth folded
/// into headers/query, disabled entries dropped, and credential values
/// resolved to either their literal value or a redaction placeholder.
///
/// Expects an already-resolved spec: any `{{variable}}` placeholders should
/// be interpolated via `VariableInterpolator` before this runs, since code
/// generators paste literal values, not templates.
public struct EffectiveRequest: Sendable, Equatable {
    public let method: String
    public let url: String
    public let headers: [EffectiveHeader]
    public let body: EffectiveBody

    public init(_ spec: RequestSpec, secrets: SecretDisplay) {
        method = spec.method.rawValue

        var headerList = spec.headers.filter(\.enabled).map {
            EffectiveHeader(name: $0.name, value: $0.value, isSecret: Redaction.isCredentialHeaderName($0.name))
        }
        var queryList = spec.query.filter(\.enabled).map {
            QueryItem(name: $0.name, value: $0.value, isSecret: Redaction.isCredentialHeaderName($0.name))
        }

        // A multipart body's Content-Type carries a boundary the client
        // library generates itself (curl `-F`, browser `FormData`); adding
        // a boundary-less header here would fight that and break parsing.
        let isMultipartBody = if case .multipart = spec.body { true } else { false }
        if !isMultipartBody, let contentType = spec.body.contentTypeHeader,
           !headerList.contains(where: { $0.name.caseInsensitiveCompare("Content-Type") == .orderedSame }) {
            headerList.append(EffectiveHeader(name: "Content-Type", value: contentType, isSecret: false))
        }

        Self.applyAuth(spec.auth, headers: &headerList, query: &queryList)

        let resolvedQuery = queryList.map { (name: $0.name, value: $0.isSecret && secrets == .redacted ? Redaction.placeholder : $0.value) }
        url = URLQuerySplitter.join(base: spec.url, items: resolvedQuery)
        headers = headerList.map { EffectiveHeader(name: $0.name, value: $0.displayValue(secrets), isSecret: $0.isSecret) }
        body = EffectiveBody(spec.body)
    }

    private struct QueryItem {
        let name: String
        let value: String
        let isSecret: Bool
    }

    private static func applyAuth(_ auth: AuthSpec, headers: inout [EffectiveHeader], query: inout [QueryItem]) {
        func setHeader(_ name: String, _ value: String) {
            headers.removeAll { $0.name.caseInsensitiveCompare(name) == .orderedSame }
            headers.append(EffectiveHeader(name: name, value: value, isSecret: true))
        }

        switch auth {
        case .inherit, .none:
            return
        case let .basic(username, password):
            let token = Data("\(username):\(password)".utf8).base64EncodedString()
            setHeader("Authorization", "Basic \(token)")
        case let .bearer(token):
            setHeader("Authorization", "Bearer \(token)")
        case let .oauth2(config):
            // A code generator has no way to run the actual OAuth2 flow, and
            // pasting nothing here would silently ship a request that can't
            // authenticate. Emit the variable Hakka writes the obtained
            // token into — literal, unresolved — so the generated snippet
            // is honest about what it needs rather than pretending it has it.
            if case let .staticToken(accessToken) = config.grant {
                setHeader("Authorization", "Bearer \(accessToken)")
            } else {
                setHeader("Authorization", "Bearer {{\(config.accessTokenVariable)}}")
            }
        case let .apiKey(name, value, placement):
            switch placement {
            case .header:
                setHeader(name, value)
            case .query:
                query.removeAll { $0.name == name }
                query.append(QueryItem(name: name, value: value, isSecret: true))
            }
        }
    }
}
