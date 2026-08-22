import Foundation
import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// `PromoteMockDraft` is the promote-to-mock sheet's plain, testable state
/// — prefilled from `CapturedMockConverter`'s own output (so an untouched
/// sheet installs exactly what the old one-click Mock button did) and
/// validated before the sheet's Install button is enabled. Covers the two
/// things the sheet's view code can't be unit-tested for directly: the
/// prefill mapping and editable-match validation.
@Suite("PromoteMockDraft prefill")
struct PromoteMockDraftPrefillTests {
    private func request(
        url: String = "https://api.example.com/v2/cart/items?token=abc",
        method: HttpMethod = .post,
        status: Int? = 500,
        error: String? = nil,
        startTime: Int64 = 0,
        duration: Int64? = 1_240,
        responseHeaders: [String: [String]] = ["Content-Type": ["application/json"]],
        responseBody: String? = #"{"error":"boom"}"#,
        responseBodySize: Int64 = 96
    ) -> NetworkRequest {
        NetworkRequest(
            url: url,
            method: method,
            status: status,
            startTime: startTime,
            duration: duration,
            responseHeaders: responseHeaders,
            responseBodySize: responseBodySize,
            responseBody: responseBody,
            error: error
        )
    }

    @Test func prefillMapsCapturedMockConverterOutputIntoTheEditableFields() throws {
        let captured = request()
        let draft = try #require(PromoteMockDraft.prefill(from: captured))

        // Editable fields come straight from CapturedMockConverter's own
        // formatter, not a second, possibly-drifting derivation.
        let rule = CapturedMockConverter.mockRule(from: captured)
        #expect(draft.method == rule.method)
        #expect(draft.pattern == rule.pattern)
        #expect(draft.pattern == "https://api.example.com/v2/cart/items", "query string is dropped, matching the converter's own match key")
    }

    @Test func prefillMapsTheServesSummaryFromTheCapturedResponse() throws {
        let draft = try #require(PromoteMockDraft.prefill(from: request(status: 500, responseBodySize: 96)))
        #expect(draft.status == 500)
        #expect(draft.contentType == "application/json")
        #expect(draft.bodySize == 96)
    }

    @Test func prefillEchoesTheCapturedRowUnedited() throws {
        let draft = try #require(PromoteMockDraft.prefill(
            from: request(url: "https://api.example.com/v2/cart/items?token=abc", method: .post, status: 500, duration: 1_240)
        ))
        #expect(draft.capturedMethod == "POST")
        #expect(draft.capturedPath == "/v2/cart/items?token=abc", "the echo shows the query the match pattern itself drops")
        #expect(draft.capturedStatus == 500)
        #expect(draft.capturedDurationMs == 1_240)
    }

    @Test func prefillFallsBackToTheRawURLWhenItDoesNotParse() throws {
        let draft = try #require(PromoteMockDraft.prefill(from: request(url: "not a url")))
        #expect(draft.capturedPath == "not a url")
    }

    @Test func prefillReturnsNilForAPendingCapture() {
        #expect(PromoteMockDraft.prefill(from: request(status: nil, error: nil)) == nil, "nothing to freeze yet")
    }

    @Test func prefillReturnsNilForARecordedTransportError() {
        #expect(PromoteMockDraft.prefill(from: request(status: nil, error: "The network connection was lost")) == nil)
    }

    @Test func prefillSucceedsForAFailureStatus() {
        // A real status, even a "failure" HTTP status, is a real response —
        // mirrors CapturedMockConverter.entry's own rule.
        #expect(PromoteMockDraft.prefill(from: request(status: 503)) != nil)
    }
}

@Suite("PromoteMockDraft validation")
struct PromoteMockDraftValidationTests {
    private func draft(method: String, pattern: String) -> PromoteMockDraft {
        PromoteMockDraft(
            method: method,
            pattern: pattern,
            status: 200,
            contentType: "application/json",
            bodySize: 12,
            capturedMethod: "GET",
            capturedPath: "/x",
            capturedStatus: 200,
            capturedDurationMs: 10,
            capturedAt: Date()
        )
    }

    @Test func validWithANonEmptyMethodAndPattern() {
        #expect(draft(method: "POST", pattern: "https://api.example.com/x").isValid)
    }

    @Test func invalidWithAnEmptyMethod() {
        #expect(!draft(method: "", pattern: "https://api.example.com/x").isValid)
    }

    @Test func invalidWithAWhitespaceOnlyMethod() {
        #expect(!draft(method: "   ", pattern: "https://api.example.com/x").isValid)
    }

    @Test func invalidWithAnEmptyPattern() {
        #expect(!draft(method: "GET", pattern: "").isValid)
    }

    @Test func invalidWithAWhitespaceOnlyPattern() {
        #expect(!draft(method: "GET", pattern: "   ").isValid)
    }

    @Test func trimmedMethodUppercasesAndTrimsWhitespace() {
        #expect(draft(method: "  patch ", pattern: "/x").trimmedMethod == "PATCH")
    }

    @Test func trimmedPatternTrimsWhitespaceOnly() {
        #expect(draft(method: "GET", pattern: "  https://api.example.com/x  ").trimmedPattern == "https://api.example.com/x")
    }
}
