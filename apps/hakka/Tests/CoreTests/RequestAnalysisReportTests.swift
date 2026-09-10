import HakkaCommon
import HakkaCore
import Testing

@Suite("RequestAnalysisReport")
struct RequestAnalysisReportTests {
    @Test func reportUsesCapturedFactsAndOmitsRawSensitiveContent() {
        let request = NetworkRequest(
            url: "https://api.example.com/v1/orders?token=very-secret&user=ada",
            method: .post,
            status: 401,
            startTime: 0,
            duration: 1500,
            requestHeaders: ["Authorization": ["Bearer top-secret"]],
            responseHeaders: ["Set-Cookie": ["session=secret"]],
            requestBodySize: 42,
            responseBodySize: 73,
            requestBody: #"{"password":"hunter2"}"#,
            responseBody: #"{"access_token":"also-secret"}"#,
            dnsMs: 4,
            connectMs: 8,
            ttfbMs: 20
        )

        let text = RequestAnalysisReport.make(for: request).text
        #expect(text.contains("https://api.example.com/v1/orders"))
        #expect(!text.contains("very-secret"))
        #expect(!text.contains("token="))
        #expect(!text.contains("top-secret"))
        #expect(!text.contains("session=secret"))
        #expect(!text.contains("hunter2"))
        #expect(!text.contains("also-secret"))
        #expect(text.contains("Next checks (not proven by this capture):"))
    }

    @Test func malformedURLAndAbsentFieldsDoNotLeakOrInventEvidence() {
        let request = NetworkRequest(
            url: "not a URL?api_key=secret",
            method: .get,
            status: nil,
            startTime: 0,
            requestHeaders: ["X-Token": ["secret"]],
            requestBody: "body secret"
        )

        let report = RequestAnalysisReport.make(for: request)
        #expect(report.evidence.contains("Request: GET Captured URL unavailable"))
        #expect(!report.text.contains("api_key=secret"))
        #expect(!report.text.contains("body secret"))
        #expect(report.finding == nil)
    }

    @Test func redirectDiagnosisRedactsQueryValuesInTheFinding() {
        let request = NetworkRequest(
            url: "https://api.example.com/start?token=first",
            method: .get,
            status: nil,
            startTime: 0,
            error: "connection reset",
            redirectCount: 1,
            redirectUrls: ["https://login.example.com/callback?code=secret"]
        )

        let report = RequestAnalysisReport.make(for: request)
        #expect(report.finding?.contains("https://login.example.com/callback") == true)
        #expect(!report.text.contains("token=first"))
        #expect(!report.text.contains("code=secret"))
    }

    @Test func reportBoundsAnOversizedCapturedPath() {
        let path = String(repeating: "a", count: 5000)
        let request = NetworkRequest(
            url: "https://api.example.com/\(path)?token=secret",
            method: .get,
            status: 200,
            startTime: 0
        )

        let text = RequestAnalysisReport.make(for: request).text
        #expect(text.count < 1500)
        #expect(!text.contains("token=secret"))
        #expect(text.contains("…"))
    }
}
