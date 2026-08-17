import Testing
@testable import HakkaNetwork
import HakkaCommon

@Suite struct URLSessionExporterTests {
    @Test func getEmitsNoHttpMethodLine() {
        let req = NetworkRequest(url: "https://api.example.com/users", method: .get, startTime: 1000)
        let swift = URLSessionExporter.export(req)
        #expect(swift.contains("URLRequest(url: URL(string: \"https://api.example.com/users\")!)"))
        #expect(!swift.contains("httpMethod"))
        #expect(swift.contains("try await URLSession.shared.data(for: request)"))
    }

    @Test func getWithHeadersEmitsSetValueLines() {
        let req = NetworkRequest(
            url: "https://api.example.com/users",
            method: .get,
            startTime: 1000,
            requestHeaders: ["Accept": ["application/json"], "X-Api-Key": ["abc123"]]
        )
        let swift = URLSessionExporter.export(req)
        #expect(swift.contains("request.setValue(\"application/json\", forHTTPHeaderField: \"Accept\")"))
        #expect(swift.contains("request.setValue(\"abc123\", forHTTPHeaderField: \"X-Api-Key\")"))
    }

    @Test func postIncludesMethodAndJsonBody() {
        let req = NetworkRequest(
            url: "https://api.example.com/users",
            method: .post,
            startTime: 1000,
            requestHeaders: ["Content-Type": ["application/json"]],
            requestBody: "{\"name\":\"test\"}"
        )
        let swift = URLSessionExporter.export(req)
        #expect(swift.contains("request.httpMethod = \"POST\""))
        #expect(swift.contains("request.setValue(\"application/json\", forHTTPHeaderField: \"Content-Type\")"))
        #expect(swift.contains("request.httpBody = Data(\"{\\\"name\\\":\\\"test\\\"}\".utf8)"))
    }

    @Test func requestWithNoBodyOmitsHttpBodyLine() {
        let req = NetworkRequest(url: "https://api.example.com/users", method: .get, startTime: 1000)
        let swift = URLSessionExporter.export(req)
        #expect(!swift.contains("httpBody"))
    }

    @Test func bodyContainingQuotesAndBackslashesEscapesCorrectly() {
        // Raw string literals make the exact character content unambiguous:
        // rawBody has 2 literal backslashes and 2 literal double quotes.
        let rawBody = #"C:\Users\test says "hi" to you"#
        let req = NetworkRequest(
            url: "https://test.com/api", method: .post, startTime: 1000, requestBody: rawBody
        )
        let swift = URLSessionExporter.export(req)
        // Every backslash must double, every quote must gain a preceding backslash.
        let expected = #"Data("C:\\Users\\test says \"hi\" to you".utf8)"#
        #expect(swift.contains(expected))
    }

    @Test func bodyContainingNewlinesEscapesToLiteralNewline() {
        let req = NetworkRequest(
            url: "https://test.com/api",
            method: .post,
            startTime: 1000,
            requestBody: "line one\nline two"
        )
        let swift = URLSessionExporter.export(req)
        #expect(swift.contains("Data(\"line one\\nline two\".utf8)"))
        // The raw newline must not appear unescaped inside the string literal.
        #expect(!swift.contains("\"line one\nline two\""))
    }

    @Test func bodyContainingSwiftInterpolationSyntaxIsNeverLive() {
        // The nastiest case: a body containing literal `\(...)` must not
        // produce a Swift string literal that performs interpolation when
        // pasted and compiled.
        let req = NetworkRequest(
            url: "https://test.com/api",
            method: .post,
            startTime: 1000,
            requestBody: "price is \\(amount) dollars"
        )
        let swift = URLSessionExporter.export(req)
        // Backslash must be doubled, and the parenthesis left untouched —
        // never a bare `\(` reaching the emitted literal.
        #expect(swift.contains("Data(\"price is \\\\(amount) dollars\".utf8)"))
        #expect(!swift.contains("price is \\(amount)"))
    }

    @Test func urlContainingQuotesIsEscaped() {
        let req = NetworkRequest(url: "https://test.com/search?q=\"weird\"", method: .get, startTime: 1000)
        let swift = URLSessionExporter.export(req)
        #expect(swift.contains("URL(string: \"https://test.com/search?q=\\\"weird\\\"\")!"))
    }

    @Test func multiValueHeadersEmitSeparateSetValueLines() {
        let req = NetworkRequest(
            url: "https://api.example.com/data", method: .get, startTime: 1000,
            requestHeaders: ["X-Custom": ["val1", "val2"]]
        )
        let swift = URLSessionExporter.export(req)
        #expect(swift.contains("forHTTPHeaderField: \"X-Custom\")"))
        let count = swift.components(separatedBy: "X-Custom").count - 1
        #expect(count == 2)
    }

    @Test func redactedHeaderValuePassesThroughUnaltered() {
        // Redaction happens upstream at capture time (Config.redactHeaders) —
        // the exporter must not further mangle an already-redacted value, and
        // must never reconstruct or leak the original secret.
        let req = NetworkRequest(
            url: "https://api.example.com/users",
            method: .get,
            startTime: 1000,
            requestHeaders: ["Authorization": ["[REDACTED]"]]
        )
        let swift = URLSessionExporter.export(req)
        #expect(swift.contains("request.setValue(\"[REDACTED]\", forHTTPHeaderField: \"Authorization\")"))
    }

    @Test func deleteMethodEmitsHttpMethodLine() {
        let req = NetworkRequest(url: "https://api.example.com/item/1", method: .delete, startTime: 1000)
        let swift = URLSessionExporter.export(req)
        #expect(swift.contains("request.httpMethod = \"DELETE\""))
    }
}
