import Foundation

enum GoCodeGenerator {
    static func generate(_ req: EffectiveRequest) -> String {
        let hasBody = if case .none = req.body { false } else { true }

        var lines = ["package main", "", "import (", "\t\"fmt\"", "\t\"io\"", "\t\"net/http\""]
        if hasBody { lines.append("\t\"strings\"") }
        lines.append(")")
        lines.append("")
        lines.append("func main() {")

        if let bodyExpression = bodyExpression(req.body) {
            lines.append("\tbody := \(bodyExpression)")
            lines.append("\treq, err := http.NewRequest(\"\(req.method)\", \"\(escape(req.url))\", body)")
        } else {
            lines.append("\treq, err := http.NewRequest(\"\(req.method)\", \"\(escape(req.url))\", nil)")
        }
        lines.append("\tif err != nil {")
        lines.append("\t\tpanic(err)")
        lines.append("\t}")
        for header in req.headers {
            lines.append("\treq.Header.Set(\"\(escape(header.name))\", \"\(escape(header.value))\")")
        }
        lines.append("")
        lines.append("\tresp, err := http.DefaultClient.Do(req)")
        lines.append("\tif err != nil {")
        lines.append("\t\tpanic(err)")
        lines.append("\t}")
        lines.append("\tdefer resp.Body.Close()")
        lines.append("")
        lines.append("\trespBody, _ := io.ReadAll(resp.Body)")
        lines.append("\tfmt.Println(string(respBody))")
        lines.append("}")
        return lines.joined(separator: "\n")
    }

    private static func bodyExpression(_ body: EffectiveBody) -> String? {
        switch body {
        case .none:
            return nil
        case let .text(text, _):
            return "strings.NewReader(\"\(escape(text))\")"
        case let .form(fields):
            let encoded = fields.map { "\(URLQuerySplitter.encode($0.name))=\(URLQuerySplitter.encode($0.value))" }
                .joined(separator: "&")
            return "strings.NewReader(\"\(escape(encoded))\")"
        case .multipart:
            return "strings.NewReader(\"\") // multipart/form-data: build with multipart.Writer before sending"
        case let .file(path, _):
            return "strings.NewReader(\"\") // read file contents from \(path) before sending"
        }
    }

    private static func escape(_ s: String) -> String {
        LanguageEscaping.escapeForQuotedString(s, quote: "\"")
    }
}
