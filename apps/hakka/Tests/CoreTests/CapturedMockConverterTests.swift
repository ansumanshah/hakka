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

    @Test func missingStatusAndBodyGetDefaultsAtTheLowLevelConverter()
    async throws {
        // `mockRule(from:)` is the unguarded low-level formatter; the refusal
        // lives one level up in `entry(from:)`, which never calls this with
        // an incomplete capture. Pinning the default here documents that
        // split rather than leaving it undefined.
        let rule = CapturedMockConverter.mockRule(
            from: record(url: "https://api.example.com/y", status: nil, body: nil, headers: [:])
        )
        #expect(rule.response.status == 200)
        #expect(rule.response.body == "")
        #expect(rule.response.headers.isEmpty)
    }

    @Test func entryRefusesAPendingOrFailedCapture()
    async throws {
        // No status at all: request never got a response (dropped, still
        // in flight when promoted, etc).
        #expect(throws: CapturedMockConverter.PromotionError.self) {
            _ = try CapturedMockConverter.entry(
                from: record(url: "https://api.example.com/y", status: nil, body: nil, headers: [:])
            )
        }
    }

    @Test func entryRefusesARecordedTransportError()
    async throws {
        var request = record(url: "https://api.example.com/y", status: nil, body: nil, headers: [:])
        request = NetworkRequest(
            id: request.id,
            url: request.url,
            method: request.method,
            status: nil,
            startTime: request.startTime,
            responseHeaders: [:],
            responseBody: nil,
            error: "The network connection was lost"
        )
        #expect(throws: CapturedMockConverter.PromotionError.self) {
            _ = try CapturedMockConverter.entry(from: request)
        }
    }

    @Test func entryPromotesACompleteCapture()
    async throws {
        // A real status, even a "failure" HTTP status, is a real response —
        // only a missing status or a transport error is refused.
        let entry = try CapturedMockConverter.entry(from: record(url: "https://api.example.com/y", status: 503))
        #expect(entry.id.hasPrefix("mck-"))
    }

    @Test func promotionIsIdempotentPerEndpoint()
    async throws {
        let first = try CapturedMockConverter.entry(from: record(url: "https://api.example.com/v1/users?page=1"))
        let second = try CapturedMockConverter.entry(from: record(url: "https://api.example.com/v1/users?page=9"))
        #expect(first.id == second.id)
        #expect(first.id.hasPrefix("mck-"))
        let other = try CapturedMockConverter.entry(
            from: record(url: "https://api.example.com/v1/users", method: .post)
        )
        #expect(other.id != first.id)
    }

    @Test func entryRoundTripsThroughTheWireEncoder()
    async throws {
        // The promotion is only real if the produced entry survives the same
        // encode → device-parse path ControlSender uses.
        let entry = try CapturedMockConverter.entry(from: record(url: "https://api.example.com/z"))
        let command = installCommand(for: entry)
        let payload = try ControlCommandEncoder.payloadObject(for: command)
        let roundTrip = parseControlCommand(payload)
        #expect(roundTrip != nil)
    }

    @Test func duplicateOrdinaryHeadersAreCommaJoinedPerRfc7230()
    async throws {
        let rule = CapturedMockConverter.mockRule(
            from: record(
                url: "https://api.example.com/w",
                headers: ["Vary": ["Accept", "Origin"]]
            )
        )
        #expect(rule.response.headers["Vary"] == "Accept, Origin")
    }

    @Test func duplicateSetCookieHeadersKeepOnlyTheFirst()
    async throws {
        // The wire shape (`MockResponse.headers: [String: String]`) can only
        // carry one value per name, and RFC 6265 forbids folding multiple
        // Set-Cookie values into one comma-joined field (a comma can appear
        // inside a cookie's own Expires attribute). Keeping the first cookie
        // is the documented, tested choice over emitting a corrupt fold.
        let rule = CapturedMockConverter.mockRule(
            from: record(
                url: "https://api.example.com/w",
                headers: ["Set-Cookie": ["session=1; Path=/", "theme=dark; Path=/"]]
            )
        )
        #expect(rule.response.headers["Set-Cookie"] == "session=1; Path=/")
    }
}
