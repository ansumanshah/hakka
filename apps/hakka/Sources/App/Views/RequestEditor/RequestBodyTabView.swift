import HakkaCore
import SwiftUI

enum BodyKind: String, CaseIterable, Identifiable {
    case none = "None"
    case raw = "Raw"
    case form = "Form"
    case multipart = "Multipart"
    case binary = "Binary"
    case graphql = "GraphQL"
    /// ADR 0012, phase 1 — only ever offered for a `grpc://`/`grpcs://`
    /// draft (see `RequestBodyTabView.availableKinds`); every other kind is
    /// hidden there in turn, since none of them are meaningful for a gRPC
    /// send.
    case grpcMessage = "Message"

    var id: String { rawValue }

    init(_ body: BodySpec) {
        switch body {
        case .none: self = .none
        case .raw: self = .raw
        case .form: self = .form
        case .multipart: self = .multipart
        case .file: self = .binary
        case .graphql: self = .graphql
        case .grpcMessage: self = .grpcMessage
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
        case .grpcMessage: .grpcMessage(hex: "")
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
                ForEach(availableKinds) { Text($0.rawValue).tag($0) }
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
            case .grpcMessage:
                RequestGrpcMessageEditor(spec: $spec)
            }
        }
    }

    /// A gRPC draft only ever sends a `.grpcMessage` body (ADR 0012) — the
    /// other kinds don't apply (no form/multipart/GraphQL/file concept in
    /// unary gRPC) — and an HTTP draft never offers `.grpcMessage`, which
    /// would be meaningless without a `GrpcTarget` parsed from the URL.
    private var availableKinds: [BodyKind] {
        GrpcURL.isGrpcURL(spec.url) ? [.grpcMessage] : BodyKind.allCases.filter { $0 != .grpcMessage }
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
