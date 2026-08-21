import HakkaCore

/// UI-facing mirror of `AuthSpec`'s cases, without the associated values —
/// what the Auth tab's type picker binds to.
enum AuthKind: String, CaseIterable, Identifiable {
    case inherit = "Inherit"
    case none = "None"
    case basic = "Basic"
    case bearer = "Bearer"
    case apiKey = "API Key"
    case oauth2 = "OAuth 2.0"

    var id: String { rawValue }

    init(_ auth: AuthSpec) {
        switch auth {
        case .inherit: self = .inherit
        case .none: self = .none
        case .basic: self = .basic
        case .bearer: self = .bearer
        case .apiKey: self = .apiKey
        case .oauth2: self = .oauth2
        }
    }

    func makeDefault() -> AuthSpec {
        switch self {
        case .inherit: .inherit
        case .none: .none
        case .basic: .basic(username: "", password: "")
        case .bearer: .bearer(token: "")
        case .apiKey: .apiKey(name: "X-API-Key", value: "", placement: .header)
        case .oauth2: .oauth2(accessToken: "")
        }
    }
}
