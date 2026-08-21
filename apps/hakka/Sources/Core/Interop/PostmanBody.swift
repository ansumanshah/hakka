import Foundation
import HakkaCommon

/// Body-mode parsing split out of `PostmanImporter` — Postman's five body
/// `mode`s (raw/urlencoded/formdata/graphql/file) each need enough
/// field-mapping logic that folding them into the main importer would blow
/// past the file's natural size.
enum PostmanBody {
    static func parse(_ body: [String: Any]?, headers: [HeaderPair]) -> BodySpec {
        guard let body, let mode = body.string("mode") else { return .none }
        switch mode {
        case "raw":
            let language = body.dict("options")?.dict("raw")?.string("language")
            return .raw(text: body.string("raw") ?? "", contentType: contentType(for: language, headers: headers))
        case "urlencoded":
            let pairs = (body.array("urlencoded") ?? []).filter { !($0.bool("disabled") ?? false) }
                .map { HeaderPair(name: $0.string("key") ?? "", value: $0.string("value") ?? "") }
            return .form(pairs)
        case "formdata":
            let parts = (body.array("formdata") ?? []).filter { !($0.bool("disabled") ?? false) }.map(part)
            return .multipart(parts)
        case "graphql":
            let gql = body.dict("graphql")
            return .graphql(query: gql?.string("query") ?? "", variables: gql?.string("variables") ?? "")
        case "file":
            return .file(path: body.dict("file")?.string("src") ?? "", contentType: "application/octet-stream")
        default:
            return .none
        }
    }

    private static func part(_ entry: [String: Any]) -> MultipartPart {
        // Postman lets a formdata entry override its part's content type; the
        // model carries it, so don't drop it on import.
        let contentType = entry.string("contentType")
        if entry.string("type") == "file" {
            return MultipartPart(name: entry.string("key") ?? "", filePath: entry.string("src"), contentType: contentType)
        }
        return MultipartPart(name: entry.string("key") ?? "", value: entry.string("value") ?? "", contentType: contentType)
    }

    private static func contentType(for language: String?, headers: [HeaderPair]) -> String {
        if let existing = headers.first(where: { $0.name.caseInsensitiveCompare("Content-Type") == .orderedSame })?.value {
            return existing
        }
        switch language {
        case "json": return "application/json"
        case "xml": return "application/xml"
        case "html": return "text/html"
        default: return "text/plain"
        }
    }
}
