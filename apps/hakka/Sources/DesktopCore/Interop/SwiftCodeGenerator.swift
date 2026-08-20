import Foundation

enum SwiftCodeGenerator {
    static func generate(_ req: EffectiveRequest) -> String {
        var lines = [
            "var request = URLRequest(url: URL(string: \"\(escape(req.url))\")!)",
            "request.httpMethod = \"\(req.method)\"",
        ]
        for header in req.headers {
            lines.append("request.setValue(\"\(escape(header.value))\", forHTTPHeaderField: \"\(escape(header.name))\")")
        }
        if let bodyLines = bodyLines(req.body) {
            lines.append(contentsOf: bodyLines)
        }
        lines.append("")
        lines.append("let (data, response) = try await URLSession.shared.data(for: request)")
        return lines.joined(separator: "\n")
    }

    private static func bodyLines(_ body: EffectiveBody) -> [String]? {
        switch body {
        case .none:
            return nil
        case let .text(text, _):
            return ["request.httpBody = Data(\"\(escape(text))\".utf8)"]
        case let .form(fields):
            let encoded = fields.map { "\(URLQuerySplitter.encode($0.name))=\(URLQuerySplitter.encode($0.value))" }
                .joined(separator: "&")
            return ["request.httpBody = Data(\"\(escape(encoded))\".utf8)"]
        case let .multipart(parts):
            var out = ["// multipart/form-data: build a boundary-delimited body before sending"]
            for part in parts {
                if let filePath = part.filePath {
                    out.append("// field \"\(part.name)\" <- file at \(filePath)")
                } else {
                    out.append("// field \"\(part.name)\" = \"\(part.value)\"")
                }
            }
            return out
        case let .file(path, _):
            return ["request.httpBody = try Data(contentsOf: URL(fileURLWithPath: \"\(escape(path))\"))"]
        }
    }

    private static func escape(_ s: String) -> String {
        LanguageEscaping.escapeForQuotedString(s, quote: "\"")
    }
}
