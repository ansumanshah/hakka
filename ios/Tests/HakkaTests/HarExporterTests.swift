import Testing
@testable import HakkaNetwork
import Foundation
import HakkaCommon

@Suite struct HarExporterTests {

    private func req(
        url: String = "https://example.com/api?page=1&limit=10",
        requestBody: String? = nil,
        dnsMs: Int64? = nil,
        connectMs: Int64? = nil,
        tlsMs: Int64? = nil,
        ttfbMs: Int64? = nil,
        downloadMs: Int64? = nil,
        networkProtocol: String? = nil
    ) -> NetworkRequest {
        NetworkRequest(
            url: url, method: .get, status: 200,
            startTime: 1_700_000_000_000, duration: 50,
            requestHeaders: ["Accept": ["*/*"], "Content-Type": ["application/json"]],
            responseHeaders: ["Content-Type": ["application/json; charset=utf-8"]],
            requestBodySize: Int64(requestBody?.utf8.count ?? 0),
            responseBodySize: 11,
            requestBody: requestBody,
            responseBody: "{\"ok\":true}",
            dnsMs: dnsMs, tlsMs: tlsMs, connectMs: connectMs,
            ttfbMs: ttfbMs, downloadMs: downloadMs,
            networkProtocol: networkProtocol
        )
    }

    @Test func exportEmpty() {
        let har = HarExporter.export([])
        #expect(har != nil)
        let json = try! JSONSerialization.jsonObject(with: har!.data(using: .utf8)!) as! [String: Any]
        let entries = (json["log"] as! [String: Any])["entries"] as! [Any]
        #expect(entries.count == 0)
    }

    @Test func exportsValidHAR12() {
        let har = HarExporter.export([req()])
        let json = try! JSONSerialization.jsonObject(with: har!.data(using: .utf8)!) as! [String: Any]
        let log = json["log"] as! [String: Any]
        #expect(log["version"] as? String == "1.2")
        let entries = log["entries"] as! [[String: Any]]
        #expect(entries.count == 1)
    }

    @Test func entryContainsRequestAndResponse() {
        let har = HarExporter.export([req()])
        let json = try! JSONSerialization.jsonObject(with: har!.data(using: .utf8)!) as! [String: Any]
        let entry = ((json["log"] as! [String: Any])["entries"] as! [[String: Any]])[0]
        #expect((entry["request"] as! [String: Any])["method"] as? String == "GET")
        #expect((entry["response"] as! [String: Any])["status"] as? Int == 200)
    }

    @Test func queryStringParsed() {
        let har = HarExporter.export([req()])
        let json = try! JSONSerialization.jsonObject(with: har!.data(using: .utf8)!) as! [String: Any]
        let request = ((json["log"] as! [String: Any])["entries"] as! [[String: Any]])[0]["request"] as! [String: Any]
        let qs = request["queryString"] as! [[String: String]]
        #expect(qs.count == 2)
        let names = Set(qs.map { $0["name"]! })
        #expect(names.contains("page"))
        #expect(names.contains("limit"))
    }

    @Test func responseMimeTypeFromContentTypeHeader() {
        let har = HarExporter.export([req()])
        let json = try! JSONSerialization.jsonObject(with: har!.data(using: .utf8)!) as! [String: Any]
        let content = (((json["log"] as! [String: Any])["entries"] as! [[String: Any]])[0]["response"] as! [String: Any])["content"] as! [String: Any]
        #expect(content["mimeType"] as? String == "application/json; charset=utf-8")
    }

    @Test func timingsUseActualPhaseData() {
        let har = HarExporter.export([req(dnsMs: 5, connectMs: 15, tlsMs: 8, ttfbMs: 30, downloadMs: 10)])
        let json = try! JSONSerialization.jsonObject(with: har!.data(using: .utf8)!) as! [String: Any]
        let timings = (((json["log"] as! [String: Any])["entries"] as! [[String: Any]])[0])["timings"] as! [String: Any]
        #expect(timings["dns"] as? Int64 == 5)
        #expect(timings["connect"] as? Int64 == 15)
        #expect(timings["ssl"] as? Int64 == 8)
        #expect(timings["wait"] as? Int64 == 30)
        #expect(timings["receive"] as? Int64 == 10)
    }

    @Test func timingsFallBackToDurationWhenNoPhaseData() {
        let har = HarExporter.export([req()])
        let json = try! JSONSerialization.jsonObject(with: har!.data(using: .utf8)!) as! [String: Any]
        let timings = (((json["log"] as! [String: Any])["entries"] as! [[String: Any]])[0])["timings"] as! [String: Any]
        #expect(timings["wait"] as? Int64 == 50)
        #expect(timings["dns"] as? Int == -1)
    }

    @Test func httpVersionFromProtocol() {
        let har = HarExporter.export([req(networkProtocol: "h2")])
        let json = try! JSONSerialization.jsonObject(with: har!.data(using: .utf8)!) as! [String: Any]
        let request = ((json["log"] as! [String: Any])["entries"] as! [[String: Any]])[0]["request"] as! [String: Any]
        #expect(request["httpVersion"] as? String == "h2")
    }

    @Test func httpVersionFallbackHTTP11() {
        let har = HarExporter.export([req()])
        let json = try! JSONSerialization.jsonObject(with: har!.data(using: .utf8)!) as! [String: Any]
        let request = ((json["log"] as! [String: Any])["entries"] as! [[String: Any]])[0]["request"] as! [String: Any]
        #expect(request["httpVersion"] as? String == "HTTP/1.1")
    }

    @Test func multiValueResponseHeadersProduceMultipleHAREntries() {
        let reqWithCookies = NetworkRequest(
            url: "https://example.com/", method: .get, status: 200,
            startTime: 0, duration: 10,
            requestHeaders: [:],
            responseHeaders: ["Set-Cookie": ["a=1; Path=/", "b=2; Path=/"]]
        )
        let har = HarExporter.export([reqWithCookies])
        let json = try! JSONSerialization.jsonObject(with: har!.data(using: .utf8)!) as! [String: Any]
        let respHeaders = (((json["log"] as! [String: Any])["entries"] as! [[String: Any]])[0]["response"] as! [String: Any])["headers"] as! [[String: String]]
        let cookieHeaders = respHeaders.filter { $0["name"] == "Set-Cookie" }
        #expect(cookieHeaders.count == 2)
    }
}
