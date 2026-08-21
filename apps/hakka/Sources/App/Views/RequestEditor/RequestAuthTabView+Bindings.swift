import HakkaCore
import SwiftUI

/// One `Binding` per `AuthSpec` associated field — split out from the view
/// body so `RequestAuthTabView.swift` stays readable as layout, not a wall
/// of get/set closures.
extension RequestAuthTabView {
    var basicUsernameBinding: Binding<String> {
        Binding(
            get: { if case let .basic(username, _) = spec.auth { username } else { "" } },
            set: { newValue in
                guard case let .basic(_, password) = spec.auth else { return }
                spec.auth = .basic(username: newValue, password: password)
            },
        )
    }

    var basicPasswordBinding: Binding<String> {
        Binding(
            get: { if case let .basic(_, password) = spec.auth { password } else { "" } },
            set: { newValue in
                guard case let .basic(username, _) = spec.auth else { return }
                spec.auth = .basic(username: username, password: newValue)
            },
        )
    }

    var bearerTokenBinding: Binding<String> {
        Binding(
            get: { if case let .bearer(token) = spec.auth { token } else { "" } },
            set: { spec.auth = .bearer(token: $0) },
        )
    }

    var oauthTokenBinding: Binding<String> {
        Binding(
            get: { if case let .oauth2(token) = spec.auth { token } else { "" } },
            set: { spec.auth = .oauth2(accessToken: $0) },
        )
    }

    var apiKeyNameBinding: Binding<String> {
        Binding(
            get: { if case let .apiKey(name, _, _) = spec.auth { name } else { "" } },
            set: { newValue in
                guard case let .apiKey(_, value, placement) = spec.auth else { return }
                spec.auth = .apiKey(name: newValue, value: value, placement: placement)
            },
        )
    }

    var apiKeyValueBinding: Binding<String> {
        Binding(
            get: { if case let .apiKey(_, value, _) = spec.auth { value } else { "" } },
            set: { newValue in
                guard case let .apiKey(name, _, placement) = spec.auth else { return }
                spec.auth = .apiKey(name: name, value: newValue, placement: placement)
            },
        )
    }

    var apiKeyPlacementBinding: Binding<APIKeyPlacement> {
        Binding(
            get: { if case let .apiKey(_, _, placement) = spec.auth { placement } else { .header } },
            set: { newValue in
                guard case let .apiKey(name, value, _) = spec.auth else { return }
                spec.auth = .apiKey(name: name, value: value, placement: newValue)
            },
        )
    }
}
