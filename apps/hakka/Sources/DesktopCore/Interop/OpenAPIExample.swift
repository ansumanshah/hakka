import Foundation
import HakkaCommon

/// Builds a `requestBody` example and parameter example values from an
/// OpenAPI operation — split out of `OpenAPIImporter` since example/schema
/// synthesis is a distinct concern from path/parameter traversal.
enum OpenAPIExample {
    static func paramValue(_ parameter: [String: Any]) -> String {
        Self.stringify(parameter["example"]) ?? Self.stringify(parameter.dict("schema")?["example"]) ?? ""
    }

    static func requestBody(_ requestBody: [String: Any]?) -> BodySpec {
        guard let content = requestBody?.dict("content") else { return .none }
        let preferredKeys = ["application/json"] + content.keys.sorted()
        guard let contentType = preferredKeys.first(where: { content[$0] != nil }),
              let media = content[contentType] as? [String: Any] else { return .none }
        return .raw(text: Self.bodyText(media), contentType: contentType)
    }

    private static func bodyText(_ media: [String: Any]) -> String {
        if let example = media["example"] {
            return Self.serialize(example)
        }
        if let examples = media.dict("examples"), let first = examples.values.first as? [String: Any], let value = first["value"] {
            return Self.serialize(value)
        }
        if let schema = media.dict("schema") {
            return Self.serialize(Self.exampleFromSchema(schema))
        }
        return "{}"
    }

    private static func exampleFromSchema(_ schema: [String: Any]) -> Any {
        switch schema.string("type") {
        case "object":
            let properties = schema.dict("properties") ?? [:]
            var object: [String: Any] = [:]
            for (key, value) in properties {
                object[key] = (value as? [String: Any]).map(Self.exampleFromSchema) ?? ""
            }
            return object
        case "array":
            if let items = schema.dict("items") { return [Self.exampleFromSchema(items)] }
            return []
        case "integer", "number": return 0
        case "boolean": return false
        default: return ""
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
