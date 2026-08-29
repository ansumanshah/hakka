import Foundation
import Testing
import HakkaCommon

@Suite struct ManualCaptureTests {
    // MARK: - The gap this closes

    /// This is the exact failure the manual-capture API exists to close: a
    /// request Hakka never saw (gRPC, a raw socket, any non-`URLSession`
    /// stack) is otherwise invisible with no way to report it, and — before
    /// this API existed — the only public insertion point (`LogStore.add`)
    /// required hand-building a `NetworkRequest` with no redaction applied,
    /// so an `Authorization` header or an API key in the body would be
    /// stored, streamed to the bridge, and exported unredacted.
    @Test func capturesTrafficHakkaWouldOtherwiseNeverSee() {
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(
                url: "https://grpc.example.com/pkg.Svc/Method",
                method: .post,
                headers: [
                    "authorization": ["Bearer super-secret-token"],
                    "content-type": ["application/json"],
                ],
                body: Data(#"{"apiKey":"sk-live-123"}"#.utf8)
            ),
            startTime: 1_700_000_000_000,
            config: HakkaConfig(sensitiveBodyFields: ["apiKey"]),
            response: HakkaManualResponse(status: 200)
        )
        // Reported at all — this is the record that previously had no path in.
        #expect(request.status == 200)
        // And redacted through the same pipeline automatic capture uses.
        #expect(request.requestHeaders["authorization"] == ["\u{2588}\u{2588}"])
        #expect(request.requestBody == #"{"apiKey":"██"}"#)
    }

    // MARK: - build()

    @Test func defaultConfigRedactsAuthorizationHeaderCaseInsensitively() {
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(url: "https://api.example.com", headers: ["Authorization": ["Bearer x"]]),
            startTime: 0,
            config: .default
        )
        #expect(request.requestHeaders["Authorization"] == ["\u{2588}\u{2588}"])
    }

    @Test func nonRedactedHeadersPassThroughUnchanged() {
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(url: "https://api.example.com", headers: ["x-request-id": ["abc-123"]]),
            startTime: 0,
            config: .default
        )
        #expect(request.requestHeaders["x-request-id"] == ["abc-123"])
    }

    @Test func responseHeadersAreRedactedTooWhenResponseProvided() {
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(url: "https://api.example.com"),
            startTime: 0,
            config: .default,
            response: HakkaManualResponse(status: 200, headers: ["Set-Cookie": ["session=abc"]])
        )
        #expect(request.responseHeaders["Set-Cookie"] == ["\u{2588}\u{2588}"])
    }

    @Test func sensitiveQueryItemRedactedButOtherParamsAndFragmentSurvive() {
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(url: "https://api.example.com/x?token=abc&page=2#top"),
            startTime: 0,
            config: HakkaConfig(sensitiveQueryItems: ["token"])
        )
        #expect(request.url == "https://api.example.com/x?token=\u{2588}\u{2588}&page=2#top")
    }

    @Test func sensitiveBodyFieldRedactedInsideNestedJson() {
        let body = Data(#"{"user":{"password":"hunter2","name":"a"}}"#.utf8)
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(
                url: "https://api.example.com",
                method: .post,
                headers: ["content-type": ["application/json"]],
                body: body
            ),
            startTime: 0,
            config: HakkaConfig(sensitiveBodyFields: ["password"])
        )
        #expect(request.requestBody == #"{"user":{"password":"██","name":"a"}}"#)
    }

    @Test func bodyFieldRedactionSkippedForNonJsonContentType() {
        let body = Data("password=hunter2".utf8)
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(
                url: "https://api.example.com",
                method: .post,
                headers: ["content-type": ["application/x-www-form-urlencoded"]],
                body: body
            ),
            startTime: 0,
            config: HakkaConfig(sensitiveBodyFields: ["password"])
        )
        // Not JSON, so the field-name redaction pass never applies — captured as-is.
        #expect(request.requestBody == "password=hunter2")
    }

    @Test func bodySizeAlwaysRecordedEvenWhenTextCaptureIsSkipped() {
        let binaryBody = Data([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01])
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(
                url: "https://api.example.com",
                method: .post,
                headers: ["content-type": ["application/x-protobuf"]],
                body: binaryBody
            ),
            startTime: 0,
            config: .default
        )
        #expect(request.requestBody == nil)
        #expect(request.requestBodySize == Int64(binaryBody.count))
    }

    @Test func bodyOverMaxSizeIsNotCapturedButSizeIsStillRecorded() {
        let body = Data(String(repeating: "a", count: 100).utf8)
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(
                url: "https://api.example.com",
                method: .post,
                headers: ["content-type": ["text/plain"]],
                body: body
            ),
            startTime: 0,
            config: HakkaConfig(maxBodySize: 10)
        )
        #expect(request.requestBody == nil)
        #expect(request.requestBodySize == 100)
    }

    @Test func deeplyNestedBodyLeftUnredactedRatherThanRisked() {
        var nested = "0"
        for _ in 0..<150 { nested = "{\"n\":\(nested)}" }
        let body = Data(nested.utf8)
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(
                url: "https://api.example.com",
                method: .post,
                headers: ["content-type": ["application/json"]],
                body: body
            ),
            startTime: 0,
            config: HakkaConfig(sensitiveBodyFields: ["n"])
        )
        // Past the depth guard: capture proceeds, but the redaction pass bails out
        // rather than recursing arbitrarily deep — the raw (unredacted) text comes
        // back unchanged, matching automatic capture's documented behavior.
        #expect(request.requestBody == nested)
    }

    @Test func errorOnlyCaptureHasNoStatusAndCarriesTheErrorString() {
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(url: "https://api.example.com"),
            startTime: 0,
            config: .default,
            error: "connection reset"
        )
        #expect(request.status == nil)
        #expect(request.error == "connection reset")
    }

    @Test func sourceIsReportedAsNativeCapture() {
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(url: "https://api.example.com"),
            startTime: 0,
            config: .default
        )
        #expect(request.source == .urlSession)
    }

    @Test func defaultIdIsPrefixedForDebuggability() {
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(url: "https://api.example.com"),
            startTime: 0,
            config: .default
        )
        #expect(request.id.hasPrefix("manual-"))
    }

    @Test func durationAndStartTimeAreCarriedThroughUnmodified() {
        let request = HakkaManualCapture.build(
            request: HakkaManualRequest(url: "https://api.example.com"),
            startTime: 1_234,
            config: .default,
            duration: 56
        )
        #expect(request.startTime == 1_234)
        #expect(request.duration == 56)
    }

    // MARK: - capture()

    @Test func captureEmitsARecordWrappingTheSameNormalizedRequest() {
        var emitted: (any ContractRecord)?
        let request = HakkaManualCapture.capture(
            request: HakkaManualRequest(url: "https://api.example.com"),
            startTime: 0,
            config: .default,
            id: "fixed-id",
            emit: { emitted = $0 }
        )
        #expect(request.id == "fixed-id")
        let record = emitted as? NetworkRecord
        #expect(record != nil)
        #expect(record?.request.id == "fixed-id")
    }

    @Test func captureWithoutEmitStillReturnsTheNormalizedRequest() {
        let request = HakkaManualCapture.capture(
            request: HakkaManualRequest(url: "https://api.example.com"),
            startTime: 0,
            config: .default
        )
        #expect(request.url == "https://api.example.com")
    }
}
