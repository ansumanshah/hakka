import Foundation

enum CurlCodeGenerator {
    static func generate(_ req: EffectiveRequest) -> String {
        var lines = ["curl -X \(req.method) '\(quote(req.url))'"]
        for header in req.headers {
            lines.append("-H '\(quote("\(header.name): \(header.value)"))'")
        }
        if let bodyArgument = bodyArgument(req.body) {
            lines.append(bodyArgument)
        }
        return zip(lines.indices, lines).map { index, line in
            index == 0 ? line : "  \(line)"
        }.joined(separator: " \\\n")
    }

    private static func bodyArgument(_ body: EffectiveBody) -> String? {
        switch body {
        case .none:
            return nil
        case let .text(text, _):
            return "-d '\(quote(text))'"
        case let .form(fields):
            let encoded = fields.map { "\(URLQuerySplitter.encode($0.name))=\(URLQuerySplitter.encode($0.value))" }
                .joined(separator: "&")
            return "-d '\(quote(encoded))'"
        case let .multipart(parts):
            return parts.map(formArgument).joined(separator: " \\\n  ")
        case let .file(path, _):
            return "--data-binary '@\(quote(path))'"
        }
    }

    private static func formArgument(_ part: EffectiveMultipartPart) -> String {
        if let filePath = part.filePath {
            let typeSuffix = part.contentType.map { ";type=\($0)" } ?? ""
            return "-F '\(quote(part.name))=@\(quote(filePath))\(typeSuffix)'"
        }
        return "-F '\(quote(part.name))=\(quote(part.value))'"
    }

    private static func quote(_ s: String) -> String {
        LanguageEscaping.escapeForShellSingleQuotes(s)
    }
}
