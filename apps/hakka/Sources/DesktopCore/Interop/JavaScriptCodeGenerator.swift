import Foundation

enum JavaScriptCodeGenerator {
    static func generate(_ req: EffectiveRequest) -> String {
        var lines = ["fetch('\(escape(req.url))', {", "  method: '\(req.method)',"]

        if !req.headers.isEmpty {
            lines.append("  headers: {")
            for (index, header) in req.headers.enumerated() {
                let comma = index == req.headers.count - 1 ? "" : ","
                lines.append("    '\(escape(header.name))': '\(escape(header.value))'\(comma)")
            }
            lines.append("  },")
        }

        if let bodyLine = bodyArgument(req.body) {
            lines.append("  \(bodyLine)")
        }

        lines.append("})")
        return lines.joined(separator: "\n")
    }

    private static func bodyArgument(_ body: EffectiveBody) -> String? {
        switch body {
        case .none:
            return nil
        case let .text(text, _):
            return "body: '\(escape(text))'"
        case let .form(fields):
            let params = fields.map { "\(escape($0.name))=\(escape($0.value))" }.joined(separator: "&")
            return "body: new URLSearchParams('\(params)')"
        case let .multipart(parts):
            var out = "body: (() => {\n    const form = new FormData();\n"
            for part in parts {
                if let filePath = part.filePath {
                    out += "    form.append('\(escape(part.name))', /* file */ '\(escape(filePath))');\n"
                } else {
                    out += "    form.append('\(escape(part.name))', '\(escape(part.value))');\n"
                }
            }
            out += "    return form;\n  })()"
            return out
        case let .file(path, _):
            return "body: /* read file contents */ '\(escape(path))'"
        }
    }

    private static func escape(_ s: String) -> String {
        LanguageEscaping.escapeForQuotedString(s, quote: "'")
    }
}
