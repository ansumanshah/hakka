import Foundation

enum HttpieCodeGenerator {
    static func generate(_ req: EffectiveRequest) -> String {
        var lines = ["http \(req.method) '\(quote(req.url))'"]
        for header in req.headers {
            lines.append("'\(quote(header.name)):\(quote(header.value))'")
        }
        let joined = zip(lines.indices, lines).map { index, line in
            index == 0 ? line : "  \(line)"
        }.joined(separator: " \\\n")

        guard let bodyText = bodyText(req.body) else { return joined }
        return joined + " \\\n  <<< '\(quote(bodyText))'"
    }

    private static func bodyText(_ body: EffectiveBody) -> String? {
        switch body {
        case .none:
            return nil
        case let .text(text, _):
            return text
        case let .form(fields):
            return fields.map { "\(URLQuerySplitter.encode($0.name))=\(URLQuerySplitter.encode($0.value))" }.joined(separator: "&")
        case .multipart:
            return nil // multipart/form-data: use `http -f field=value field@path` instead of stdin
        case let .file(path, _):
            return "@\(path)" // placeholder — httpie reads uploads via `field@path`, not stdin
        }
    }

    private static func quote(_ s: String) -> String {
        LanguageEscaping.escapeForShellSingleQuotes(s)
    }
}
