import Testing
@testable import HakkaNetwork
import HakkaCommon

@Suite struct CurlExporterTests {
    @Test func simpleGetOmitsXFlag() {
        let req = NetworkRequest(url: "https://api.example.com/users", method: .get, startTime: 1000)
        let curl = CurlExporter.export(req)
        #expect(curl.hasPrefix("curl"))
        #expect(!curl.contains("-X"))
        #expect(curl.contains("'https://api.example.com/users'"))
    }

    @Test func postIncludesXAndBody() {
        let req = NetworkRequest(
            url: "https://api.example.com/users",
            method: .post,
            startTime: 1000,
            requestHeaders: ["Content-Type": ["application/json"]],
            requestBody: "{\"name\":\"test\"}"
        )
        let curl = CurlExporter.export(req)
        #expect(curl.contains("-X POST"))
        #expect(curl.contains("-H 'Content-Type: application/json'"))
        #expect(curl.contains("-d '{\"name\":\"test\"}'"))
    }

    @Test func escapesSingleQuotes() {
        let req = NetworkRequest(url: "https://test.com", method: .get, startTime: 1000,
                                 requestHeaders: ["X-Test": ["it's a test"]])
        let curl = CurlExporter.export(req)
        #expect(curl.contains("it'\\''s a test"))
    }

    @Test func multiValueHeadersEmitSeparateHFlags() {
        let req = NetworkRequest(
            url: "https://api.example.com/data", method: .get, startTime: 1000,
            requestHeaders: [
                "Accept": ["application/json"],
                "X-Custom": ["val1", "val2"],
            ]
        )
        let curl = CurlExporter.export(req)
        let count = curl.components(separatedBy: "-H").count - 1
        #expect(count == 3) // Accept + X-Custom val1 + X-Custom val2
        #expect(curl.contains("-H 'X-Custom: val1'"))
        #expect(curl.contains("-H 'X-Custom: val2'"))
    }

    @Test func deleteMethodEmitsXFlag() {
        let req = NetworkRequest(url: "https://api.example.com/item/1", method: .delete, startTime: 1000)
        let curl = CurlExporter.export(req)
        #expect(curl.contains("-X DELETE"))
    }

    // MARK: - Edge cases

    @Test func urlContainingSingleQuotes() {
        let req = NetworkRequest(url: "https://test.com/search?q=it's", method: .get, startTime: 1000)
        let curl = CurlExporter.export(req)
        #expect(curl.contains("it'\\''s"))
        #expect(!curl.contains("-X")) // GET omits -X
    }

    @Test func bodyContainingSingleQuotes() {
        let req = NetworkRequest(
            url: "https://test.com/api",
            method: .post,
            startTime: 1000,
            requestBody: "{\"name\":\"it's a test\"}"
        )
        let curl = CurlExporter.export(req)
        #expect(curl.contains("-d"))
        #expect(curl.contains("it'\\''s a test"))
    }

    @Test func headerKeyWithSingleQuotes() {
        let req = NetworkRequest(
            url: "https://test.com",
            method: .get,
            startTime: 1000,
            requestHeaders: ["X-It's-Header": ["value"]]
        )
        let curl = CurlExporter.export(req)
        #expect(curl.contains("X-It'\\''s-Header: value"))
    }

    @Test func requestWithNoHeaders() {
        let req = NetworkRequest(url: "https://test.com/path", method: .get, startTime: 1000)
        let curl = CurlExporter.export(req)
        #expect(!curl.contains("-H"))
        #expect(curl.contains("curl"))
        #expect(curl.contains("'https://test.com/path'"))
    }

    @Test func patchMethod() {
        let req = NetworkRequest(
            url: "https://api.example.com/users/1",
            method: .patch,
            startTime: 1000,
            requestHeaders: ["Content-Type": ["application/json"]],
            requestBody: "{\"name\":\"updated\"}"
        )
        let curl = CurlExporter.export(req)
        #expect(curl.contains("-X PATCH"))
        #expect(curl.contains("-H 'Content-Type: application/json'"))
        #expect(curl.contains("-d '{\"name\":\"updated\"}'"))
    }

    @Test func putMethod() {
        let req = NetworkRequest(url: "https://api.example.com/item/1", method: .put, startTime: 1000)
        let curl = CurlExporter.export(req)
        #expect(curl.contains("-X PUT"))
    }

    @Test func headMethod() {
        let req = NetworkRequest(url: "https://api.example.com/health", method: .head, startTime: 1000)
        let curl = CurlExporter.export(req)
        #expect(curl.contains("-X HEAD"))
    }

    @Test func optionsMethod() {
        let req = NetworkRequest(url: "https://api.example.com/cors", method: .options, startTime: 1000)
        let curl = CurlExporter.export(req)
        #expect(curl.contains("-X OPTIONS"))
    }
}
