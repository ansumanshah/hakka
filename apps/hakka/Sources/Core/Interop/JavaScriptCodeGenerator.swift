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
            // Object literal, not `new URLSearchParams('name=value&...')` — the
            // string constructor form parses its argument as an already-encoded
            // query string, so a field name/value containing `&`, `=`, or `+`
            // would silently inject or reinterpret fields. The object form
            // takes each entry as a literal string instead.
            guard !fields.isEmpty else { return "body: new URLSearchParams({})" }
            var out = "body: new URLSearchParams({\n"
            for (index, field) in fields.enumerated() {
                let comma = index == fields.count - 1 ? "" : ","
                out += "    '\(escape(field.name))': '\(escape(field.value))'\(comma)\n"
            }
            out += "  })"
            return out
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
