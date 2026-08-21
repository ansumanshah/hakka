import HakkaCore
import SwiftUI

struct RequestAuthTabView: View {
    @Binding var spec: RequestSpec

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Type", selection: kindBinding) {
                ForEach(AuthKind.allCases) { Text($0.rawValue).tag($0) }
            }
            .frame(maxWidth: 220)

            switch spec.auth {
            case .inherit, .none:
                EmptyView()
            case .basic:
                basicFields
            case .bearer:
                LabeledField("Token", text: bearerTokenBinding, secure: true)
            case .apiKey:
                apiKeyFields
            case .oauth2:
                OAuth2AuthSectionView(spec: $spec)
            }
            Spacer()
        }
    }

    var basicFields: some View {
        VStack(alignment: .leading, spacing: 8) {
            LabeledField("Username", text: basicUsernameBinding)
            LabeledField("Password", text: basicPasswordBinding, secure: true)
        }
    }

    var apiKeyFields: some View {
        VStack(alignment: .leading, spacing: 8) {
            LabeledField("Name", text: apiKeyNameBinding)
            LabeledField("Value", text: apiKeyValueBinding, secure: true)
            Picker("Add to", selection: apiKeyPlacementBinding) {
                Text("Header").tag(APIKeyPlacement.header)
                Text("Query").tag(APIKeyPlacement.query)
            }
            .frame(maxWidth: 220)
        }
    }

    var kindBinding: Binding<AuthKind> {
        Binding(get: { AuthKind(spec.auth) }, set: { spec.auth = $0.makeDefault() })
    }
}
