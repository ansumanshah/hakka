import Testing
@testable import HakkaNetwork
import HakkaCommon

@Suite("Multi-Value Header Splitting")
struct MultiValueHeaderTests {

    @Test("Splits comma-separated Cache-Control values")
    func splitsCacheControl() {
        let headers: [String: [String]] = ["Cache-Control": ["no-cache, no-store, must-revalidate"]]
        let result = RequestBuilder.splitMultiValueHeaders(headers)
        #expect(result["Cache-Control"] == ["no-cache", "no-store", "must-revalidate"])
    }

    @Test("Splits comma-separated Set-Cookie values")
    func splitsSetCookie() {
        let headers: [String: [String]] = ["Set-Cookie": ["a=1, b=2"]]
        let result = RequestBuilder.splitMultiValueHeaders(headers)
        #expect(result["Set-Cookie"] == ["a=1", "b=2"])
    }

    @Test("Does not split non-multi-value headers")
    func preservesSingleValueHeaders() {
        let headers: [String: [String]] = ["Content-Type": ["application/json; charset=utf-8"]]
        let result = RequestBuilder.splitMultiValueHeaders(headers)
        #expect(result["Content-Type"] == ["application/json; charset=utf-8"])
    }

    @Test("Case-insensitive header matching")
    func caseInsensitive() {
        let headers: [String: [String]] = ["CACHE-CONTROL": ["no-cache, private"]]
        let result = RequestBuilder.splitMultiValueHeaders(headers)
        #expect(result["CACHE-CONTROL"] == ["no-cache", "private"])
    }

    @Test("Empty headers pass through")
    func emptyHeaders() {
        let result = RequestBuilder.splitMultiValueHeaders([:])
        #expect(result.isEmpty)
    }
}
