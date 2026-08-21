import Foundation

enum PythonCodeGenerator {
    static func generate(_ req: EffectiveRequest) -> String {
        var lines = ["import requests", "", "url = \"\(escape(req.url))\""]

        if !req.headers.isEmpty {
            lines.append("headers = {")
            for header in req.headers {
                lines.append("    \"\(escape(header.name))\": \"\(escape(header.value))\",")
            }
            lines.append("}")
        }

        let dataArgument = bodyArgument(req.body, lines: &lines)

        lines.append("")
        var call = "response = requests.request(\"\(req.method)\", url"
        if !req.headers.isEmpty { call += ", headers=headers" }
        if let dataArgument { call += ", \(dataArgument)" }
        call += ")"
        lines.append(call)

        return lines.joined(separator: "\n")
    }

    private static func bodyArgument(_ body: EffectiveBody, lines: inout [String]) -> String? {
        switch body {
        case .none:
            return nil
        case let .text(text, _):
            lines.append("data = \"\(escape(text))\"")
            return "data=data"
        case let .form(fields):
            lines.append("data = {")
            for field in fields { lines.append("    \"\(escape(field.name))\": \"\(escape(field.value))\",") }
            lines.append("}")
            return "data=data"
        case let .multipart(parts):
            lines.append("files = {")
            for part in parts {
                if let filePath = part.filePath {
                    lines.append("    \"\(escape(part.name))\": open(\"\(escape(filePath))\", \"rb\"),")
                } else {
                    lines.append("    \"\(escape(part.name))\": (None, \"\(escape(part.value))\"),")
                }
            }
            lines.append("}")
            return "files=files"
        case let .file(path, _):
            lines.append("data = open(\"\(escape(path))\", \"rb\")")
            return "data=data"
        }
    }

    private static func escape(_ s: String) -> String {
        LanguageEscaping.escapeForQuotedString(s, quote: "\"")
    }
}
