import Testing
@testable import HakkaNetwork
import Foundation
import HakkaCommon

@Suite struct NetworkRequestTests {
    @Test func defaultValues() {
        let req = NetworkRequest(url: "https://example.com", method: .get, startTime: 1000)
        #expect(!req.id.isEmpty)
        #expect(req.url == "https://example.com")
        #expect(req.method == .get)
        #expect(req.status == nil)
        #expect(req.duration == nil)
        #expect(req.requestHeaders == [:])
        #expect(req.responseHeaders == [:])
        #expect(req.requestBodySize == 0)
        #expect(req.responseBodySize == 0)
        #expect(req.requestBody == nil)
        #expect(req.responseBody == nil)
        #expect(req.error == nil)
        #expect(req.source == .urlSession)
    }

    @Test func httpMethodParsing() {
        #expect(HttpMethod(rawString: "post") == .post)
        #expect(HttpMethod(rawString: "DELETE") == .delete)
        #expect(HttpMethod(rawString: "unknown") == .get) // fallback
    }

    @Test func codable() throws {
        let req = NetworkRequest(
            url: "https://api.test.com/data", method: .post, status: 200, startTime: 123456, duration: 42,
            requestHeaders: ["Content-Type": ["application/json"]], requestBody: "{}", source: .jsFetch
        )
        let data = try JSONEncoder().encode(req)
        let decoded = try JSONDecoder().decode(NetworkRequest.self, from: data)
        #expect(req == decoded)
    }

    @Test func requestSourceCodableUsesCanonicalWireValues() throws {
        let req = NetworkRequest(
            url: "https://api.test.com/data",
            method: .post,
            startTime: 123456,
            source: .jsFetch
        )
        let data = try JSONEncoder().encode(req)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["source"] as? String == "fetch")
        let decoded = try JSONDecoder().decode(NetworkRequest.self, from: data)
        #expect(decoded.source == .jsFetch)

        let mockData = try JSONEncoder().encode(RequestSource.mock)
        #expect(String(data: mockData, encoding: .utf8) == "\"native\"")
        #expect(try JSONDecoder().decode(RequestSource.self, from: Data("\"jsXHR\"".utf8)) == .jsXHR)
    }

    @Test func timingFieldsDefault() {
        let req = NetworkRequest(url: "https://example.com", method: .get, startTime: 1000)
        #expect(req.dnsMs == nil)
        #expect(req.tlsMs == nil)
        #expect(req.connectMs == nil)
        #expect(req.ttfbMs == nil)
        #expect(req.downloadMs == nil)
        #expect(req.redirectCount == 0)
        #expect(req.redirectUrls.isEmpty)
    }

    @Test func timingFieldsSet() {
        let req = NetworkRequest(url: "https://example.com", method: .get, startTime: 1000,
                                 dnsMs: 5, tlsMs: 12, connectMs: 20, ttfbMs: 30, downloadMs: 100,
                                 redirectCount: 2, redirectUrls: ["https://old.com", "https://mid.com"])
        #expect(req.dnsMs == 5)
        #expect(req.tlsMs == 12)
        #expect(req.connectMs == 20)
        #expect(req.ttfbMs == 30)
        #expect(req.downloadMs == 100)
        #expect(req.redirectCount == 2)
        #expect(req.redirectUrls == ["https://old.com", "https://mid.com"])
    }

    @Test func timingCodable() throws {
        let req = NetworkRequest(url: "https://api.test.com/data", method: .get, startTime: 123456,
                                 dnsMs: 5, tlsMs: 10, connectMs: 15, ttfbMs: 20, downloadMs: 50,
                                 redirectCount: 1, redirectUrls: ["https://old.com"])
        let data = try JSONEncoder().encode(req)
        let decoded = try JSONDecoder().decode(NetworkRequest.self, from: data)
        #expect(req == decoded)
        #expect(decoded.dnsMs == 5)
        #expect(decoded.redirectCount == 1)
        #expect(decoded.redirectUrls == ["https://old.com"])
    }

    @Test func equatable() {
        let req1 = NetworkRequest(id: "abc", url: "https://test.com", method: .get, startTime: 100)
        let req2 = NetworkRequest(id: "abc", url: "https://test.com", method: .get, startTime: 100)
        #expect(req1 == req2)
    }

    @Test func tlsFields() {
        let req = NetworkRequest(url: "https://example.com", method: .get, startTime: 1000,
                                 tlsVersion: "TLSv1.3", cipherSuite: "AES_128_GCM_SHA256")
        #expect(req.tlsVersion == "TLSv1.3")
        #expect(req.cipherSuite == "AES_128_GCM_SHA256")
    }

    @Test func tlsFieldsDefaultNil() {
        let req = NetworkRequest(url: "https://example.com", method: .get, startTime: 1000)
        #expect(req.tlsVersion == nil)
        #expect(req.cipherSuite == nil)
    }

    @Test func networkProtocol() {
        let req = NetworkRequest(url: "https://example.com", method: .get, startTime: 1000, networkProtocol: "h2")
        #expect(req.networkProtocol == "h2")
    }

    @Test func networkProtocolDefaultNil() {
        #expect(NetworkRequest(url: "https://example.com", method: .get, startTime: 1000).networkProtocol == nil)
    }

    @Test func graphQLOperationName() {
        let req = NetworkRequest(url: "https://example.com/graphql", method: .post, startTime: 1000,
                                 graphqlOperationName: "GetUser")
        #expect(req.graphqlOperationName == "GetUser")
    }

    @Test func graphQLOperationNameDefaultNil() {
        #expect(NetworkRequest(url: "https://example.com", method: .get, startTime: 1000).graphqlOperationName == nil)
    }

    @Test func multiValueHeaders() {
        let req = NetworkRequest(
            url: "https://example.com", method: .get, startTime: 1000,
            requestHeaders: ["Accept": ["application/json", "text/html"]],
            responseHeaders: ["Set-Cookie": ["a=1; Path=/", "b=2; Path=/"]]
        )
        #expect(req.requestHeaders["Accept"] == ["application/json", "text/html"])
        #expect(req.responseHeaders["Set-Cookie"] == ["a=1; Path=/", "b=2; Path=/"])
    }

    @Test func newFieldsCodable() throws {
        let req = NetworkRequest(
            url: "https://example.com/graphql", method: .post, startTime: 1000,
            tlsVersion: "TLSv1.3", cipherSuite: "AES_128_GCM_SHA256",
            networkProtocol: "h2", graphqlOperationName: "GetUser"
        )
        let data = try JSONEncoder().encode(req)
        let decoded = try JSONDecoder().decode(NetworkRequest.self, from: data)
        #expect(decoded.tlsVersion == "TLSv1.3")
        #expect(decoded.cipherSuite == "AES_128_GCM_SHA256")
        #expect(decoded.networkProtocol == "h2")
        #expect(decoded.graphqlOperationName == "GetUser")
    }

    // MARK: - HttpMethod edge cases

    @Test func httpMethodUnknownStringDefaultsToGet() {
        #expect(HttpMethod(rawString: "CONNECT") == .get)
        #expect(HttpMethod(rawString: "TRACE") == .get)
        #expect(HttpMethod(rawString: "") == .get)
        #expect(HttpMethod(rawString: "foobar") == .get)
    }

    @Test func httpMethodCaseInsensitive() {
        #expect(HttpMethod(rawString: "get") == .get)
        #expect(HttpMethod(rawString: "Post") == .post)
        #expect(HttpMethod(rawString: "pUt") == .put)
        #expect(HttpMethod(rawString: "patch") == .patch)
        #expect(HttpMethod(rawString: "delete") == .delete)
        #expect(HttpMethod(rawString: "HEAD") == .head)
        #expect(HttpMethod(rawString: "options") == .options)
    }

    @Test func httpMethodAllCasesContainsExpected() {
        let all = HttpMethod.allCases
        #expect(all.count == 7)
        #expect(all.contains(.get))
        #expect(all.contains(.post))
        #expect(all.contains(.put))
        #expect(all.contains(.patch))
        #expect(all.contains(.delete))
        #expect(all.contains(.head))
        #expect(all.contains(.options))
    }

    // MARK: - RequestSource edge cases

    @Test func requestSourceRawValueRoundTrip() {
        for source: RequestSource in [.urlSession, .jsFetch, .jsXHR, .jsWebSocket, .mock] {
            let raw = source.rawValue
            let roundTripped = RequestSource(rawValue: raw)
            #expect(roundTripped == source)
        }
    }

    @Test func requestSourceDisplayNames() {
        #expect(RequestSource.urlSession.displayName == "URLSession")
        #expect(RequestSource.jsFetch.displayName == "JS Fetch")
        #expect(RequestSource.jsXHR.displayName == "JS XHR")
        #expect(RequestSource.jsWebSocket.displayName == "JS WebSocket")
        #expect(RequestSource.mock.displayName == "Mock")
        #expect(RequestSource.urlSession.hakkaWireValue == "native")
        #expect(RequestSource.mock.hakkaWireValue == "native")
        #expect(RequestSource.jsFetch.hakkaWireValue == "fetch")
        #expect(RequestSource.jsXHR.hakkaWireValue == "xhr")
        #expect(RequestSource.jsWebSocket.hakkaWireValue == "websocket")
    }

    // MARK: - NetworkRequest with all optional fields nil

    @Test func allOptionalFieldsNil() {
        let req = NetworkRequest(url: "https://example.com", method: .get, startTime: 1000)
        #expect(req.status == nil)
        #expect(req.duration == nil)
        #expect(req.requestBody == nil)
        #expect(req.responseBody == nil)
        #expect(req.error == nil)
        #expect(req.dnsMs == nil)
        #expect(req.tlsMs == nil)
        #expect(req.connectMs == nil)
        #expect(req.ttfbMs == nil)
        #expect(req.downloadMs == nil)
        #expect(req.tlsVersion == nil)
        #expect(req.cipherSuite == nil)
        #expect(req.networkProtocol == nil)
        #expect(req.graphqlOperationName == nil)
        #expect(req.requestHeaders.isEmpty)
        #expect(req.responseHeaders.isEmpty)
        #expect(req.requestBodySize == 0)
        #expect(req.responseBodySize == 0)
        #expect(req.redirectCount == 0)
        #expect(req.redirectUrls.isEmpty)
    }

    // MARK: - NetworkRequest with all optional fields set

    @Test func allOptionalFieldsSet() {
        let req = NetworkRequest(
            id: "full-request",
            url: "https://api.example.com/graphql",
            method: .post,
            status: 200,
            startTime: 1000,
            duration: 500,
            requestHeaders: ["Content-Type": ["application/json"], "Authorization": ["Bearer token"]],
            responseHeaders: ["Content-Type": ["application/json"], "Set-Cookie": ["a=1", "b=2"]],
            requestBodySize: 128,
            responseBodySize: 256,
            requestBody: "{\"query\":\"{ users { id } }\"}",
            responseBody: "{\"data\":{\"users\":[]}}",
            error: "timeout",
            source: .jsFetch,
            dnsMs: 5,
            tlsMs: 12,
            connectMs: 20,
            ttfbMs: 35,
            downloadMs: 100,
            redirectCount: 2,
            redirectUrls: ["https://old.com", "https://mid.com"],
            tlsVersion: "TLSv1.3",
            cipherSuite: "AES_256_GCM_SHA384",
            networkProtocol: "h2",
            graphqlOperationName: "GetUsers"
        )

        #expect(req.id == "full-request")
        #expect(req.status == 200)
        #expect(req.duration == 500)
        #expect(req.requestHeaders.count == 2)
        #expect(req.responseHeaders["Set-Cookie"]?.count == 2)
        #expect(req.requestBodySize == 128)
        #expect(req.responseBodySize == 256)
        #expect(req.requestBody != nil)
        #expect(req.responseBody != nil)
        #expect(req.error == "timeout")
        #expect(req.source == .jsFetch)
        #expect(req.dnsMs == 5)
        #expect(req.tlsMs == 12)
        #expect(req.connectMs == 20)
        #expect(req.ttfbMs == 35)
        #expect(req.downloadMs == 100)
        #expect(req.redirectCount == 2)
        #expect(req.redirectUrls.count == 2)
        #expect(req.tlsVersion == "TLSv1.3")
        #expect(req.cipherSuite == "AES_256_GCM_SHA384")
        #expect(req.networkProtocol == "h2")
        #expect(req.graphqlOperationName == "GetUsers")
    }

    // MARK: - NetworkRequest ID uniqueness

    @Test func idUniqueness() {
        let req1 = NetworkRequest(url: "https://example.com", method: .get, startTime: 1000)
        let req2 = NetworkRequest(url: "https://example.com", method: .get, startTime: 1000)
        #expect(req1.id != req2.id)
        #expect(!req1.id.isEmpty)
        #expect(!req2.id.isEmpty)
    }

    // MARK: - Codable round-trip with all fields

    @Test func fullCodableRoundTrip() throws {
        let req = NetworkRequest(
            id: "rt-test",
            url: "https://api.example.com/graphql",
            method: .post,
            status: 201,
            startTime: 999999,
            duration: 1234,
            requestHeaders: ["Accept": ["application/json", "text/html"]],
            responseHeaders: ["Set-Cookie": ["a=1", "b=2"]],
            requestBodySize: 50,
            responseBodySize: 100,
            requestBody: "{\"query\":\"{users}\"}",
            responseBody: "{\"data\":[]}",
            error: "partial",
            source: .jsXHR,
            dnsMs: 1,
            tlsMs: 2,
            connectMs: 3,
            ttfbMs: 4,
            downloadMs: 5,
            redirectCount: 1,
            redirectUrls: ["https://redirect.com"],
            tlsVersion: "TLSv1.2",
            cipherSuite: "ECDHE_RSA",
            networkProtocol: "http/1.1",
            graphqlOperationName: "ListUsers"
        )
        let data = try JSONEncoder().encode(req)
        let decoded = try JSONDecoder().decode(NetworkRequest.self, from: data)
        #expect(req == decoded)
    }

    // MARK: - Equatable with different IDs

    @Test func notEqualWithDifferentIds() {
        let req1 = NetworkRequest(id: "id-1", url: "https://test.com", method: .get, startTime: 100)
        let req2 = NetworkRequest(id: "id-2", url: "https://test.com", method: .get, startTime: 100)
        #expect(req1 != req2)
    }

    // MARK: - Header lookup (case-insensitive) — backs the detail Overview
    // field-completeness contract (Content-Type / Encoding rows).

    @Test func responseHeaderValueIsCaseInsensitive() {
        let req = NetworkRequest(
            url: "https://test.com", method: .get, startTime: 0,
            responseHeaders: ["Content-Type": ["application/json"]]
        )
        #expect(req.responseHeaderValue("content-type") == "application/json")
        #expect(req.responseHeaderValue("CONTENT-TYPE") == "application/json")
        #expect(req.contentType == "application/json")
    }

    @Test func responseHeaderValueReturnsNilWhenAbsent() {
        let req = NetworkRequest(url: "https://test.com", method: .get, startTime: 0)
        #expect(req.responseHeaderValue("content-type") == nil)
        #expect(req.contentType == nil)
        #expect(req.contentEncoding == nil)
    }

    @Test func contentEncodingReadsGzipHeader() {
        let req = NetworkRequest(
            url: "https://test.com", method: .get, startTime: 0,
            responseHeaders: ["content-encoding": ["gzip"]]
        )
        #expect(req.contentEncoding == "gzip")
    }

    @Test func isWebSocketRequestTrueForNativeAndJsSources() {
        let native = NetworkRequest(url: "wss://test.com", method: .get, startTime: 0, source: .nativeWebSocket)
        let js = NetworkRequest(url: "wss://test.com", method: .get, startTime: 0, source: .jsWebSocket)
        let fetch = NetworkRequest(url: "https://test.com", method: .get, startTime: 0, source: .jsFetch)
        #expect(native.isWebSocketRequest)
        #expect(js.isWebSocketRequest)
        #expect(!fetch.isWebSocketRequest)
    }
}
