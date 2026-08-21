import Foundation
import HakkaCommon

/// `BodySpec` flattened into what a code generator actually needs to
/// render: disabled form/multipart fields already dropped, GraphQL already
/// folded into the JSON payload it's sent as.
public enum EffectiveBody: Sendable, Equatable {
    case none
    case text(body: String, contentType: String)
    case form(fields: [EffectiveFormField])
    case multipart(parts: [EffectiveMultipartPart])
    case file(path: String, contentType: String)

    init(_ spec: BodySpec) {
        switch spec {
        case .none:
            self = .none
        case let .raw(text, contentType):
            self = .text(body: text, contentType: contentType)
        case let .form(pairs):
            self = .form(fields: pairs.filter(\.enabled).map { EffectiveFormField(name: $0.name, value: $0.value) })
        case let .multipart(parts):
            self = .multipart(parts: parts.filter(\.enabled).map {
                EffectiveMultipartPart(name: $0.name, value: $0.value, filePath: $0.filePath, contentType: $0.contentType)
            })
        case let .graphql(query, variables):
            self = .text(body: Self.graphqlPayload(query: query, variables: variables), contentType: "application/json")
        case let .file(path, contentType):
            self = .file(path: path, contentType: contentType)
        }
    }

    /// GraphQL is sent as `{"query": ..., "variables": ...}` — `variables`
    /// is already JSON text (see `BodySpec.graphql`'s doc comment), so it's
    /// spliced in verbatim rather than round-tripped through
    /// `JSONSerialization`, which has no way to embed a pre-serialized
    /// fragment without re-parsing it first.
    private static func graphqlPayload(query: String, variables: String) -> String {
        let trimmed = variables.trimmingCharacters(in: .whitespacesAndNewlines)
        let variablesJSON = trimmed.isEmpty ? "{}" : trimmed
        let escapedQuery = LanguageEscaping.escapeForQuotedString(query, quote: "\"")
        return "{\"query\":\"\(escapedQuery)\",\"variables\":\(variablesJSON)}"
    }
}

public struct EffectiveFormField: Sendable, Equatable {
    public let name: String
    public let value: String
}

public struct EffectiveMultipartPart: Sendable, Equatable {
    public let name: String
    public let value: String
    public let filePath: String?
    public let contentType: String?
}
