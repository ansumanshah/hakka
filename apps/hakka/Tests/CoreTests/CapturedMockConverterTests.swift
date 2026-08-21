import HakkaCommon
import HakkaCore
import Testing

@Suite("CapturedMockConverter")
struct CapturedMockConverterTests {
    private func record(
        url: String,
        method: HttpMethod = .get,
        status: Int? = 200,
        body: String? = #"{"ok":true}"#,
        headers: [String: [String]] = ["Content-Type": ["application/json"]]
    ) -> NetworkRequest {
        NetworkRequest(
            url: url,
            method: method,
            status: status,
            startTime: 1_000,
            responseHeaders: headers,
            responseBody: body
        )
    }

    @Test func patternTargetsTheEndpointNotTheQuery()
    async throws {
        let rule = CapturedMockConverter.mockRule(from: record(url: "https://api.example.com/v1/users?page=2&token=abc"))
        #expect(rule.pattern == "https://api.example.com/v1/users")
        #expect(rule.isRegex == false)
    }

    @Test func patternKeepsPortAndPath()
    async throws {
        let rule = CapturedMockConverter.mockRule(from: record(url: "http://localhost:8080/a/b/c"))
        #expect(rule.pattern == "http://localhost:8080/a/b/c")
    }

    @Test func unparseableUrlFallsBackToRawString()
    async throws {
        let rule = CapturedMockConverter.mockRule(from: record(url: "not a url"))
        #expect(rule.pattern == "not a url")
    }

    @Test func responseCarriesStatusBodyAndSafeHeaders()
    async throws {
        let rule = CapturedMockConverter.mockRule(
            from: record(
                url: "https://api.example.com/x",
                method: .post,
                status: 418,
                headers: [
                    "Content-Type": ["application/json"],
                    "Set-Cookie": ["session=1"],
                    "Content-Encoding": ["gzip"],
                    "Content-Length": ["1234"],
                    "Transfer-Encoding": ["chunked"],
                ]
            )
        )
        #expect(rule.method == "POST")
        #expect(rule.response.status == 418)
        #expect(rule.response.body == #"{"ok":true}"#)
        #expect(rule.response.headers["Content-Type"] == "application/json")
        #expect(rule.response.headers["Set-Cookie"] == "session=1")
        #expect(rule.response.headers["Content-Encoding"] == nil)
        #expect(rule.response.headers["Content-Length"] == nil)
        #expect(rule.response.headers["Transfer-Encoding"] == nil)
    }

    @Test func missingStatusAndBodyGetDefaults()
    async throws {
        let rule = CapturedMockConverter.mockRule(
            from: record(url: "https://api.example.com/y", status: nil, body: nil, headers: [:])
        )
        #expect(rule.response.status == 200)
        #expect(rule.response.body == "")
        #expect(rule.response.headers.isEmpty)
    }

    @Test func promotionIsIdempotentPerEndpoint()
    async throws {
        let first = CapturedMockConverter.entry(from: record(url: "https://api.example.com/v1/users?page=1"))
        let second = CapturedMockConverter.entry(from: record(url: "https://api.example.com/v1/users?page=9"))
        #expect(first.id == second.id)
        #expect(first.id.hasPrefix("mck-"))
        let other = CapturedMockConverter.entry(
            from: record(url: "https://api.example.com/v1/users", method: .post)
        )
        #expect(other.id != first.id)
    }

    @Test func entryRoundTripsThroughTheWireEncoder()
    async throws {
        // The promotion is only real if the produced entry survives the same
        // encode → device-parse path ControlSender uses.
        let entry = CapturedMockConverter.entry(from: record(url: "https://api.example.com/z"))
        let command = installCommand(for: entry)
        let payload = try ControlCommandEncoder.payloadObject(for: command)
        let roundTrip = parseControlCommand(payload)
        #expect(roundTrip != nil)
    }
}
