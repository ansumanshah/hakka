import Foundation
import XCTest
@testable import HakkaProxyEngine

final class CapturePrivacyTests: XCTestCase {
    func testCompleteSecretsAreRedactedBeforeObservation() throws {
        let body = #"{"user":"fixture","nested":[{"access_token":"body-secret"}],"password":"other-secret"}"#
        let raw = ProxyFlow(startedAt: 0, endedAt: 1, method: "POST",
            url: "https://user:url-secret@example.test/login?token=query-secret&safe=value#fragment",
            requestHeaders: [.init(name: "Authorization", value: "Bearer header-secret"),
                             .init(name: "Content-Type", value: "application/json")],
            responseHeaders: [.init(name: "Set-Cookie", value: "session=cookie-secret")], requestBody: body)
        let encoded = String(decoding: try JSONEncoder().encode(FlowRedactor.redact(raw)), as: UTF8.self)
        for secret in ["url-secret", "query-secret", "header-secret", "body-secret", "other-secret", "cookie-secret"] {
            XCTAssertFalse(encoded.contains(secret), secret)
        }
        XCTAssertTrue(encoded.contains("fixture"))
        XCTAssertTrue(encoded.contains("safe=value"))
    }

    func testPartialAndUnparseableJSONIsWithheld() {
        var flow = ProxyFlow(startedAt: 0, endedAt: 1, method: "POST", url: "http://example.test/",
            requestHeaders: [.init(name: "Content-Type", value: "application/json")],
            requestBody: #"{"password":"secret"}"#, requestBodyTruncated: true)
        XCTAssertNil(FlowRedactor.redact(flow).requestBody)
        flow.requestBodyTruncated = false
        flow.requestBody = #"{"password":"secret""#
        XCTAssertNil(FlowRedactor.redact(flow).requestBody)
        flow.requestBody = String(repeating: "[", count: 65) + "0" + String(repeating: "]", count: 65)
        XCTAssertNil(FlowRedactor.redact(flow).requestBody)
    }
}
