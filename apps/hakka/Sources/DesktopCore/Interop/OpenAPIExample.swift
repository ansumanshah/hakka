import Foundation
import HakkaCommon

/// Builds a `requestBody` example and parameter example values from an
/// OpenAPI operation — split out of `OpenAPIImporter` since example/schema
/// synthesis is a distinct concern from path/parameter traversal.
///
/// Every schema goes through `OpenAPIRefResolver` first, because referenced
/// schemas are the norm in real specs rather than the exception.
enum OpenAPIExample {
    static func paramValue(_ parameter: [String: Any], resolver: OpenAPIRefResolver) -> String {
        let parameter = resolver.resolve(parameter)
        if let direct = Self.stringify(parameter["example"]) { return direct }
        guard let schema = parameter.dict("schema") else { return "" }
        return Self.stringify(resolver.resolve(schema)["example"]) ?? ""
    }

    static func requestBody(_ requestBody: [String: Any]?, resolver: OpenAPIRefResolver) -> BodySpec {
        guard let requestBody else { return .none }
        guard let content = resolver.resolve(requestBody).dict("content") else { return .none }
        let preferredKeys = ["application/json"] + content.keys.sorted()
        guard let contentType = preferredKeys.first(where: { content[$0] != nil }),
              let media = content[contentType] as? [String: Any] else { return .none }
        return .raw(text: Self.bodyText(media, resolver: resolver), contentType: contentType)
    }

    private static func bodyText(_ media: [String: Any], resolver: OpenAPIRefResolver) -> String {
        if let example = media["example"] {
            return Self.serialize(example)
        }
        if let examples = media.dict("examples"), let first = examples.values.first as? [String: Any], let value = first["value"] {
            return Self.serialize(value)
        }
        if let schema = media.dict("schema") {
            return Self.serialize(Self.exampleFromSchema(schema, resolver: resolver, seen: []))
        }
        return "{}"
    }

    /// `seen` carries the `$ref` names already expanded on this branch. A
    /// schema that references itself (a tree node with children of its own
    /// type, say) is legal and common; without this it would recurse forever.
    private static func exampleFromSchema(_ rawSchema: [String: Any], resolver: OpenAPIRefResolver, seen: Set<String>) -> Any {
        var seen = seen
        if let ref = resolver.refName(rawSchema) {
            if seen.contains(ref) { return [:] as [String: Any] }
            seen.insert(ref)
        }
        let schema = resolver.resolve(rawSchema)

        if let example = schema["example"] { return example }

        // allOf is composition: merge every branch's object into one. oneOf and
        // anyOf are alternatives, so the first branch is a representative
        // example — the importer's job is a runnable starting point, not an
        // exhaustive enumeration of every variant.
        if let allOf = schema.array("allOf") {
            var merged: [String: Any] = [:]
            for branch in allOf {
                if let object = Self.exampleFromSchema(branch, resolver: resolver, seen: seen) as? [String: Any] {
                    merged.merge(object) { _, new in new }
                }
            }
            return merged
        }
        if let alternatives = schema.array("oneOf") ?? schema.array("anyOf"), let first = alternatives.first {
            return Self.exampleFromSchema(first, resolver: resolver, seen: seen)
        }

        switch schema.string("type") {
        case "object":
            let properties = schema.dict("properties") ?? [:]
            var object: [String: Any] = [:]
            for (key, value) in properties {
                object[key] = (value as? [String: Any]).map { Self.exampleFromSchema($0, resolver: resolver, seen: seen) } ?? ""
            }
            return object
        case "array":
            if let items = schema.dict("items") { return [Self.exampleFromSchema(items, resolver: resolver, seen: seen)] }
            return []
        case "integer", "number": return 0
        case "boolean": return false
        case "string": return ""
        default:
            // No `type`, but properties present — the common shorthand for an
            // object. Guessing `""` here is what turned a referenced body into
            // an empty string.
            if schema.dict("properties") != nil {
                let properties = schema.dict("properties") ?? [:]
                var object: [String: Any] = [:]
                for (key, value) in properties {
                    object[key] = (value as? [String: Any]).map { Self.exampleFromSchema($0, resolver: resolver, seen: seen) } ?? ""
                }
                return object
            }
            return ""
        }
    }

    private static func serialize(_ value: Any) -> String {
        if let string = value as? String {
            return "\"\(LanguageEscaping.escapeForQuotedString(string, quote: "\""))\""
        }
        if let boolValue = value as? Bool {
            return boolValue ? "true" : "false"
        }
        if let number = value as? NSNumber {
            return number.stringValue
        }
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return "{}" }
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private static func stringify(_ value: Any?) -> String? {
        guard let value, !(value is NSNull) else { return nil }
        if let string = value as? String { return string }
        if let boolValue = value as? Bool { return boolValue ? "true" : "false" }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }
}
