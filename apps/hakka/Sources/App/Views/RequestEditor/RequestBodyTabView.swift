import HakkaCore
import SwiftUI

enum BodyKind: String, CaseIterable, Identifiable {
    case none = "None"
    case raw = "Raw"
    case form = "Form"
    case graphql = "GraphQL"

    var id: String { rawValue }

    init(_ body: BodySpec) {
        switch body {
        case .none: self = .none
        case .raw: self = .raw
        case .form: self = .form
        case .graphql: self = .graphql
        case .multipart, .file: self = .none
        }
    }

    func makeDefault() -> BodySpec {
        switch self {
        case .none: .none
        case .raw: .raw(text: "", contentType: "application/json")
        case .form: .form([])
        case .graphql: .graphql(query: "", variables: "{}")
        }
    }
}

/// Body editor for the kinds the UI can build from scratch — None/Raw/Form/
/// GraphQL. Multipart and file bodies (created via cURL/HAR/OpenAPI import,
/// not from this tab) render read-only instead of being silently dropped.
struct RequestBodyTabView: View {
    @Binding var spec: RequestSpec

    var body: some View {
        switch spec.body {
        case .multipart, .file:
            readOnlySummary
        default:
            editableBody
        }
    }

    private var editableBody: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("", selection: kindBinding) {
                ForEach(BodyKind.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            switch spec.body {
            case .none:
                EmptyView()
            case .raw:
                RequestRawBodyEditor(spec: $spec)
            case .form:
                HeaderPairListEditor(pairs: formBinding, namePlaceholder: "Field", addTitle: "Add Field")
            case .graphql:
                RequestGraphQLBodyEditor(spec: $spec)
            case .multipart, .file:
                EmptyView()
            }
        }
    }

    private var readOnlySummary: some View {
        let message: String = switch spec.body {
        case let .multipart(parts): "Multipart body — \(parts.count) part(s)."
        case let .file(path, _): "File body — \(path)"
        default: ""
        }
        return EmptyStateView(systemImage: "doc", title: "Body not editable here", message: message)
    }

    private var kindBinding: Binding<BodyKind> {
        Binding(get: { BodyKind(spec.body) }, set: { spec.body = $0.makeDefault() })
    }

    private var formBinding: Binding<[HeaderPair]> {
        Binding(
            get: { if case let .form(pairs) = spec.body { pairs } else { [] } },
            set: { spec.body = .form($0) },
        )
    }
}
