import HakkaCore
import SwiftUI

enum BodyKind: String, CaseIterable, Identifiable {
    case none = "None"
    case raw = "Raw"
    case form = "Form"
    case multipart = "Multipart"
    case binary = "Binary"
    case graphql = "GraphQL"

    var id: String { rawValue }

    init(_ body: BodySpec) {
        switch body {
        case .none: self = .none
        case .raw: self = .raw
        case .form: self = .form
        case .multipart: self = .multipart
        case .file: self = .binary
        case .graphql: self = .graphql
        }
    }

    func makeDefault() -> BodySpec {
        switch self {
        case .none: .none
        case .raw: .raw(text: "", contentType: "application/json")
        case .form: .form([])
        case .multipart: .multipart([])
        case .binary: .file(path: "", contentType: "application/octet-stream")
        case .graphql: .graphql(query: "", variables: "{}", operationName: nil)
        }
    }
}

/// Body editor for the request's Body tab. Every `BodySpec` case the app can
/// send is editable from here — including multipart and binary, which used
/// to arrive only via cURL/HAR/OpenAPI import and render read-only.
struct RequestBodyTabView: View {
    @Binding var spec: RequestSpec

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
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
            case .multipart:
                RequestMultipartBodyEditor(spec: $spec)
            case .file:
                RequestBinaryBodyEditor(spec: $spec)
            case .graphql:
                RequestGraphQLBodyEditor(spec: $spec)
            }
        }
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
