import Foundation
import HakkaCommon
import Testing
import HakkaCore

/// Confirms the desktop's `Content-Encoding: gzip`/`deflate` decode path
/// genuinely agrees with `decoders.test.ts`, the canonical fixture source
/// SPEC.md footnote 10 requires every port to match. Desktop does not carry
/// its own gzip/deflate implementation — `RecordBodyExtractor`
/// (`Sources/Core/Detail/RecordBody.swift`) runs every captured body through
/// `HakkaCommon.bodyDecoders`, the same `BodyDecoderRegistry` iOS registers
/// its `GzipBodyDecoder`/`DeflateBodyDecoder` into (`InflateSupport.swift`,
/// built on Apple's `Compression` framework) — so this suite exercises the
/// desktop's actual display path (`RecordBodyExtractor`), not a
/// reimplementation, and its fixtures are real independently-produced
/// gzip/zlib bytes rather than a round-trip through the same encoder the
/// decoder under test would also decompress.
///
/// Fixture provenance: the base64 blobs below were generated once with
/// Python's standard-library `gzip`/`zlib` modules (`python3 -c`), an
/// implementation with no code path in common with either Apple's
/// `Compression` framework (what `InflateSupport` decodes with) or `fflate`
/// (what `decoders.test.ts` compresses with) — a genuine cross-implementation
/// check, not two ports of the same library agreeing with themselves. The
/// plaintext originals are the exact strings `decoders.test.ts` compresses
/// (`'{"hello":"world","n":42}'`, `'plain text body'`, the 100-item array),
/// so a divergence here is a real behavioral gap against the TS chain, not
/// an artifact of picking different test data.
@Suite("Content-Encoding decode — gzip/deflate parity")
struct ContentEncodingDecodeTests {
    // MARK: - Fixtures (see file doc comment for provenance)

    /// gzip of `{"hello":"world","n":42}` — mirrors decoders.test.ts's
    /// "decompresses a gzip-compressed base64 body".
    private static let gzipHelloWorld = "H4sIAAAAAAAC/6tWykjNyclXslIqzy/KSVHSUcpTsjIxqgUAmzhNjRgAAAA="

    /// zlib-wrapped deflate of the same string — mirrors decoders.test.ts's
    /// "decompresses a deflate-compressed base64 body". HTTP
    /// `Content-Encoding: deflate` in practice means zlib-wrapped deflate
    /// (RFC 2616), matching `looksLikeDeflateBase64`'s CMF/FLG guard.
    private static let deflateHelloWorld = "eJyrVspIzcnJV7JSKs8vyklR0lHKU7IyMaoFAGM1B3U="

    /// gzip of `plain text body` — mirrors decoders.test.ts's
    /// "decompresses with content-encoding x-gzip".
    private static let gzipPlainTextBody = "H4sIAAAAAAAC/yvISczMUyhJrShRSMpPqQQA1DqbHQ8AAAA="

    /// gzip of the 100-item `{"items":[{"id":0,"name":"item-0"}, …]}` array —
    /// mirrors decoders.test.ts's "decompresses larger payload correctly".
    private static let gzipLargePayload = "H4sIAAAAAAAC/13WMW7dMBAA0buodgBzyV2S/ypBigBx4cJp7M7w3RMkgEaaVlPtA0Xu5/H68fL2fjy+fx6vv47H89Px++fby/H49/3b8/H19D+0e2hniHuIM/R76GcY9zDOkPeQZ6h7qDPMe5hnWPewzrDvYTOgRm+X2T080zeN35i/CaAh0ETQMGhCaCg0MTQcmiAaEk0UDYsmjIZGSCPQCGnE5Sz4MKAR0gg0QhqBRkgj0AhpBBohjUAjpBFohDQCjS6NjkaXRkejS6Nf/g3/HGh0aXQ0ujQ6Gl0aHY0ujY5Gl0ZHo0ujozGkMdAY0hhoDGkMNIY0xuWu8GWBxpDGQGNIY6AxpDHQGNIYaAxpDDRSGolGSiPRSGkkGimNRCOlkZe705cnGimNRCOlkWikNBKNlEaiUdIoNEoahUZJo9AoaRQaJY1Co6RRl7fEjwkaJY1Co6RRaJQ0Co0pjYnGlMZEY0pjojGlMdGY0phoTGlMNKY05uVt9eOKxpTGRGNKY6KxpLHQWNJYaCxpLDSWNBYaSxoLjSWNhcaSxkJjSWNddg0vG2gsaSw0tjQ2GlsaG40tjY3GlsZGY0tjo7GlsdHY0thobGlsNLY09mX38vL1V+PH1x8P3luRgwoAAA=="

    /// The 100-item payload the fixture above compresses — kept as a literal
    /// so the assertion checks the exact bytes, not merely "parses as JSON".
    private static let largePayload: String = {
        let items = (0..<100).map { "{\"id\":\($0),\"name\":\"item-\($0)\"}" }.joined(separator: ",")
        return "{\"items\":[\(items)]}"
    }()

    // MARK: - Round-trip through the real display path

    /// The exact path a response takes to screen: capture → base64 body +
    /// headers on `NetworkRequest` → `RecordBodyExtractor.responseBody` →
    /// `HakkaCommon.bodyDecoders`. A regression here is what the user would
    /// actually see as binary garbage in the Response tab.
    @Test
    func gzipResponseDecodesThroughRecordBodyExtractor() {
        let record = NetworkRequest(
            id: "1", url: "https://api.test/data", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["gzip"]],
            responseBody: Self.gzipHelloWorld
        )
        #expect(RecordBodyExtractor.responseBody(from: record)?.text == #"{"hello":"world","n":42}"#)
    }

    @Test
    func deflateResponseDecodesThroughRecordBodyExtractor() {
        let record = NetworkRequest(
            id: "1", url: "https://api.test/data", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["deflate"]],
            responseBody: Self.deflateHelloWorld
        )
        #expect(RecordBodyExtractor.responseBody(from: record)?.text == #"{"hello":"world","n":42}"#)
    }

    /// `x-gzip` is an alias real servers still send (`hasEncoding` in both
    /// `decoders.ts` and `hakkaHasEncoding` treat it identically to `gzip`).
    @Test
    func xGzipAliasDecodes() {
        let decoded = bodyDecoders.decode(Self.gzipPlainTextBody, contentType: "text/plain", contentEncoding: "x-gzip")
        #expect(decoded == "plain text body")
    }

    @Test
    func largeGzipPayloadDecodesByteForByte() {
        let record = NetworkRequest(
            id: "1", url: "https://api.test/items", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["gzip"]],
            responseBody: Self.gzipLargePayload
        )
        #expect(RecordBodyExtractor.responseBody(from: record)?.text == Self.largePayload)
    }

    // MARK: - Directly against the shared registry (bypassing NetworkRequest)

    /// Same fixture as `gzipResponseDecodesThroughRecordBodyExtractor`, but
    /// called straight against `HakkaCommon.bodyDecoders` — isolates a
    /// registry-level regression from a `RecordBodyExtractor` wiring
    /// regression.
    @Test
    func bodyDecodersGunzipMatchesIndependentFixture() {
        let decoded = bodyDecoders.decode(Self.gzipHelloWorld, contentType: "application/json", contentEncoding: "gzip")
        #expect(decoded == #"{"hello":"world","n":42}"#)
    }

    @Test
    func bodyDecodersInflateMatchesIndependentFixture() {
        let decoded = bodyDecoders.decode(Self.deflateHelloWorld, contentType: "application/json", contentEncoding: "deflate")
        #expect(decoded == #"{"hello":"world","n":42}"#)
    }

    // MARK: - Fail-open: truncated input never throws, never loses the body

    /// A response cut off mid-stream (client disconnect, proxy buffering, a
    /// flaky capture) must not crash the app or blank the pane — the raw
    /// captured text is strictly better than nothing. Truncated by dropping
    /// trailing bytes from a *valid* gzip stream (distinct from outright
    /// garbage below): this is the shape a real partial capture takes.
    @Test
    func truncatedGzipFailsOpenToOriginalBody() {
        let truncated = "H4sIAAAAAAAC/6tWykjNyclXslIqzy/KSVHSUcpTsjIxqg=="
        let record = NetworkRequest(
            id: "1", url: "https://api.test/data", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["gzip"]],
            responseBody: truncated
        )
        // Decompression fails → the registry falls through to passthrough →
        // the captured (still-compressed) base64 text is what's shown, not
        // an empty pane or a crash.
        #expect(RecordBodyExtractor.responseBody(from: record)?.text == truncated)
    }

    @Test
    func truncatedDeflateFailsOpenToOriginalBody() {
        let truncated = "eJyrVspIzcnJV7JSKs8vyklR0lHKU7IyMao="
        let record = NetworkRequest(
            id: "1", url: "https://api.test/data", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["deflate"]],
            responseBody: truncated
        )
        #expect(RecordBodyExtractor.responseBody(from: record)?.text == truncated)
    }

    // MARK: - Fail-open: corrupt input (valid magic, garbage payload)

    /// Correct gzip magic bytes (so the cheap `looksLikeGzipBase64` guard
    /// admits it) followed by bytes that are not a valid DEFLATE stream —
    /// the case a hand-crafted or mid-stream-corrupted capture produces.
    @Test
    func corruptGzipBodyFailsOpen() {
        let corrupt = "H4sIAAAAAAAA/corrupt+data+here=="
        let record = NetworkRequest(
            id: "1", url: "https://api.test/data", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["gzip"]],
            responseBody: corrupt
        )
        #expect(RecordBodyExtractor.responseBody(from: record)?.text == corrupt)
    }

    @Test
    func corruptDeflateBodyFailsOpen() {
        let corrupt = "eJwcorrupt+data+here=="
        let record = NetworkRequest(
            id: "1", url: "https://api.test/data", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["deflate"]],
            responseBody: corrupt
        )
        #expect(RecordBodyExtractor.responseBody(from: record)?.text == corrupt)
    }

    // MARK: - Passthrough: an uncompressed body is never touched

    /// No `Content-Encoding` at all — the overwhelmingly common case — must
    /// cost nothing and change nothing.
    @Test
    func uncompressedBodyWithNoEncodingHeaderPassesThroughUntouched() {
        let plain = #"{"already":"decoded","value":42}"#
        let record = NetworkRequest(
            id: "1", url: "https://api.test/data", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"]],
            responseBody: plain
        )
        #expect(RecordBodyExtractor.responseBody(from: record)?.text == plain)
    }

    /// `Content-Encoding: gzip` on a body that is plain text, not gzip bytes
    /// — a header/body mismatch the decoder must not trust blindly (the
    /// `looksLikeGzipBase64` magic-byte guard is what saves it).
    @Test
    func plainBodyWithMisleadingGzipHeaderPassesThroughUntouched() {
        let plain = #"{"already":"decoded"}"#
        let record = NetworkRequest(
            id: "1", url: "https://api.test/data", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["gzip"]],
            responseBody: plain
        )
        #expect(RecordBodyExtractor.responseBody(from: record)?.text == plain)
    }

    /// A request body (not just responses) round-trips the same way —
    /// `RecordBodyExtractor.requestBody` shares `makeBody`/`decodedText`
    /// with the response side, but this pins that the request-side headers
    /// (`requestContentEncoding`, not `contentEncoding`) actually get wired.
    @Test
    func deflateRequestBodyDecodesThroughRecordBodyExtractor() {
        let record = NetworkRequest(
            id: "1", url: "https://api.test/data", method: .post, status: 200, startTime: 1,
            requestHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["deflate"]],
            requestBody: Self.deflateHelloWorld
        )
        #expect(RecordBodyExtractor.requestBody(from: record)?.text == #"{"hello":"world","n":42}"#)
    }
}
