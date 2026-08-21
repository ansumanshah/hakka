import Compression
import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

@Suite("BodyViewerRegistry dispatch")
struct BodyViewerRegistryTests {
    @Test(arguments: [
        ("application/json", "{\"users\":[{\"id\":1}],\"ok\":true}", .jsonTree),
        ("application/json; charset=utf-8", "{\"users\":[{\"id\":1}],\"ok\":true}", .jsonTree),
        ("application/vnd.api+json", "{\"users\":[{\"id\":1}],\"ok\":true}", .jsonTree),
        ("text/json", "{\"users\":[{\"id\":1}],\"ok\":true}", .jsonTree),
        ("image/png", "iVBORw0KGgo=", .image),
        ("image/jpeg; charset=binary", "/9j/4AAQSkZJRg==", .image),
        ("application/octet-stream", "AAAAAA==", .hex),
        ("application/x-protobuf", "CgE=", .hex),
        ("application/grpc+proto", "AAAAAA==", .hex),
        ("application/pdf", "JVBERi0=", .hex),
        ("application/zip", "UEsDBg==", .hex),
        ("text/plain", "just some prose", .text),
        ("text/html", "<html><body>hi</body></html>", .text),
        ("application/xml", "<users><user/></users>", .text),
        (nil, "just some prose", .text),
    ] as [(String?, String, BodyViewerKind)])
    func dispatchesByContentType(_ contentType: String?, _ body: String, _ expected: BodyViewerKind) {
        let kind = BodyViewerRegistry.viewerKind(forContentType: contentType, url: "https://api.test/users", body: body)
        #expect(kind == expected)
    }

    @Test
    func jsonScalarRootPrefersPrettyViewer() {
        #expect(BodyViewerRegistry.viewerKind(forContentType: "application/json", body: "42") == .jsonPretty)
        #expect(BodyViewerRegistry.viewerKind(forContentType: "application/json", body: "\"hello\"") == .jsonPretty)
        #expect(BodyViewerRegistry.viewerKind(forContentType: "application/json", body: "true") == .jsonPretty)
        #expect(BodyViewerRegistry.viewerKind(forContentType: "application/json", body: "null") == .jsonPretty)
    }

    @Test
    func unparseableJsonContentTypeFallsBackToText() {
        #expect(BodyViewerRegistry.viewerKind(forContentType: "application/json", body: "{\"ok\": tru") == .text)
        #expect(BodyViewerRegistry.viewerKind(forContentType: "application/json", body: "<html>not json</html>") == .text)
    }

    /// Bodies captured without a usable content type still deserve the JSON
    /// viewer when they parse as containers; scalar sniffing stays text —
    /// `"42"` under `text/plain` is prose until a header says otherwise.
    @Test
    func untypedContainerBodySniffsToJsonTree() {
        let body = "{\"ok\":true}"
        #expect(BodyViewerRegistry.viewerKind(forContentType: nil, body: body) == .jsonTree)
        #expect(BodyViewerRegistry.viewerKind(forContentType: "text/plain", body: body) == .jsonTree)
        #expect(BodyViewerRegistry.viewerKind(forContentType: nil, body: "just some text") == .text)
        #expect(BodyViewerRegistry.viewerKind(forContentType: "text/plain", body: "42") == .text)
    }

    @Test
    func imageDataURLAndImageURLSniffDispatchToImage() {
        let pngBase64 = Data([0x89, 0x50, 0x4e, 0x47]).base64EncodedString()
        #expect(
            BodyViewerRegistry.viewerKind(forContentType: nil, body: "data:image/png;base64,\(pngBase64)") == .image
        )
        #expect(
            BodyViewerRegistry.viewerKind(forContentType: nil, url: "https://cdn.test/logo.png", body: pngBase64)
                == .image
        )
        // An image URL under an explicit non-image content type is not an
        // image — the header wins.
        #expect(
            BodyViewerRegistry.viewerKind(
                forContentType: "application/json", url: "https://cdn.test/logo.png", body: "{\"ok\":true}"
            ) == .jsonTree
        )
    }
}

@Suite("RecordBodyExtractor")
struct RecordBodyExtractorTests {
    @Test
    func extractsDecodedResponseBodyWithHeaders() {
        let record = NetworkRequest(
            id: "1", url: "https://api.test/users", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["identity"]],
            responseBody: "{\"ok\":true}"
        )
        let body = RecordBodyExtractor.responseBody(from: record)
        #expect(body?.text == "{\"ok\":true}")
        #expect(body?.contentType == "application/json")
        #expect(body?.contentEncoding == "identity")
    }

    @Test
    func missingOrEmptyBodiesExtractToNil() {
        let record = NetworkRequest(id: "1", url: "https://api.test", method: .get, startTime: 1)
        #expect(RecordBodyExtractor.responseBody(from: record) == nil)
        #expect(RecordBodyExtractor.requestBody(from: record) == nil)
        let empty = NetworkRequest(
            id: "2", url: "https://api.test", method: .get, startTime: 1, responseBody: ""
        )
        #expect(RecordBodyExtractor.responseBody(from: empty) == nil)
    }

    /// Compressed bodies reach the record contract as base64 bytes; the
    /// extractor must hand back the decompressed text through the same
    /// decoder pipeline every other Hakka surface uses.
    @Test
    func decodesGzippedResponseBody() throws {
        let payload = #"{"message":"compressed","items":[1,2,3]}"#
        let gzipped = try #require(Self.gzip(Array(payload.utf8)))

        let record = NetworkRequest(
            id: "1", url: "https://api.test/data", method: .get, status: 200, startTime: 1,
            responseHeaders: ["Content-Type": ["application/json"], "Content-Encoding": ["gzip"]],
            responseBody: Data(gzipped).base64EncodedString()
        )
        #expect(RecordBodyExtractor.responseBody(from: record)?.text == payload)
    }

    @Test
    func decodesDeflatedRequestBody() throws {
        let payload = "name=Ansh&role=chef"
        let deflated = try #require(Self.zlibDeflate(Array(payload.utf8)))

        let record = NetworkRequest(
            id: "1", url: "https://api.test/login", method: .post, startTime: 1,
            requestHeaders: ["Content-Type": ["application/x-www-form-urlencoded"], "Content-Encoding": ["deflate"]],
            requestBody: Data(deflated).base64EncodedString()
        )
        #expect(RecordBodyExtractor.requestBody(from: record)?.text == payload)
    }

    @Test
    func headerLookupSurvivesCaseDifferences() {
        let record = NetworkRequest(
            id: "1", url: "https://api.test", method: .get, startTime: 1,
            responseHeaders: ["CONTENT-TYPE": ["text/plain"]],
            responseBody: "hello"
        )
        #expect(RecordBodyExtractor.responseBody(from: record)?.contentType == "text/plain")
    }

    // MARK: - Compressed-payload builders (hand-assembled containers around
    // the Compression framework's raw DEFLATE, since nothing in the app
    // encodes gzip).

    private static func gzip(_ input: [UInt8]) -> [UInt8]? {
        guard let deflate = rawDeflate(input), !deflate.isEmpty else { return nil }
        // 10-byte gzip header (no flags), deflate payload, 8-byte trailer
        // (CRC32 + ISIZE — the decoder ignores both).
        var out: [UInt8] = [0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff]
        out.append(contentsOf: deflate)
        out.append(contentsOf: [UInt8](repeating: 0, count: 8))
        return out
    }

    private static func zlibDeflate(_ input: [UInt8]) -> [UInt8]? {
        guard let deflate = rawDeflate(input), !deflate.isEmpty else { return nil }
        // zlib CMF/FLG header (0x78 0x9c), deflate payload, dummy Adler-32.
        var out: [UInt8] = [0x78, 0x9c]
        out.append(contentsOf: deflate)
        out.append(contentsOf: [UInt8](repeating: 0, count: 4))
        return out
    }

    private static func rawDeflate(_ input: [UInt8]) -> [UInt8]? {
        guard !input.isEmpty else { return nil }
        let capacity = input.count + 1024
        var destination = [UInt8](repeating: 0, count: capacity)
        let written = input.withUnsafeBufferPointer { source in
            destination.withUnsafeMutableBufferPointer { dest in
                compression_encode_buffer(
                    dest.baseAddress!, capacity,
                    source.baseAddress!, input.count,
                    nil, COMPRESSION_ZLIB
                )
            }
        }
        guard written > 0 else { return nil }
        return Array(destination[0..<written])
    }
}

@Suite("BodyDisplayCap")
struct BodyDisplayCapTests {
    @Test
    func bodyUnderCapPassesThroughUnchanged() {
        let capped = BodyDisplayCap.cap(String(repeating: "a", count: BodyDisplayCap.characterLimit))
        #expect(capped.isTruncated == false)
        #expect(capped.hiddenCharacterCount == 0)
        #expect(capped.displayedText.count == BodyDisplayCap.characterLimit)
    }

    @Test
    func bodyOverCapIsClippedWithHiddenCount() {
        let text = String(repeating: "b", count: BodyDisplayCap.characterLimit + 123)
        let capped = BodyDisplayCap.cap(text)
        #expect(capped.isTruncated == true)
        #expect(capped.hiddenCharacterCount == 123)
        #expect(capped.displayedText.count == BodyDisplayCap.characterLimit)
        #expect(capped.displayedText.hasPrefix("bbb"))
    }

    @Test
    func capLimitIsRespectedWhenOverridden() {
        let capped = BodyDisplayCap.cap("abcdef", at: 3)
        #expect(capped.displayedText == "abc")
        #expect(capped.hiddenCharacterCount == 3)
    }
}

@Suite("BodyMatchScanner")
struct BodyMatchScannerTests {
    @Test
    func emptyQueryOrTextFindsNothing() {
        #expect(BodyMatchScanner.scan(query: "", in: "haystack").isEmpty)
        #expect(BodyMatchScanner.scan(query: "  ", in: "haystack").isEmpty)
        #expect(BodyMatchScanner.scan(query: "hay", in: "").isEmpty)
    }

    @Test
    func scanIsCaseInsensitiveAndAdvancesPastEachMatch() {
        let matches = BodyMatchScanner.scan(query: "NEEDLE", in: "needle in a Needle stack")
        #expect(matches.map(\.start) == [0, 12])
        #expect(matches.allSatisfy { $0.count == 6 })
    }

    @Test
    func overlappingOccurrencesAreSkippedNotDoubleCounted() {
        let matches = BodyMatchScanner.scan(query: "aa", in: "aaaa")
        #expect(matches.map(\.start) == [0, 2])
    }

    @Test
    func queryMissingFromBodyFindsNothing() {
        #expect(BodyMatchScanner.scan(query: "zzz", in: "haystack").isEmpty)
    }
}

@Suite("JSONOutlineNode")
struct JSONOutlineNodeTests {
    private let sample = """
    {"users":[{"name":"Alice","active":true},{"name":null}],"total":2,"ratio":1.5}
    """

    @Test
    func parsesContainersWithKindAndCount() throws {
        let root = try #require(JSONOutlineNode.parse(sample))
        #expect(root.kind == .object)
        #expect(root.isExpandable == true)
        #expect(root.childCount == 3)
        #expect(root.displayValue == nil)
    }

    @Test
    func childrenMaterializeOnceAndInSortedKeyOrder() throws {
        let root = try #require(JSONOutlineNode.parse(sample))
        let first = root.children()
        let second = root.children()
        #expect(first.map(\.key) == ["ratio", "total", "users"])
        #expect(first.map(\.id) == ["root.ratio", "root.total", "root.users"])
        // Identical instances on the second call — materialization is cached,
        // so expanding and collapsing never rebuilds the subtree.
        #expect(zip(first, second).allSatisfy { $0 === $1 })
        #expect(first[0].kind == .number)
        #expect(first[0].displayValue == "1.5")
        #expect(first[1].displayValue == "2")
    }

    @Test
    func arrayChildrenCarryNoKeyButIndexedIdentity() throws {
        let root = try #require(JSONOutlineNode.parse(sample))
        let users = try #require(root.children().first { $0.key == "users" })
        #expect(users.kind == .array)
        #expect(users.childCount == 2)
        let elements = users.children()
        #expect(elements.allSatisfy { $0.key == nil })
        #expect(elements.map(\.id) == ["root.users[0]", "root.users[1]"])
    }

    @Test
    func leafKindsRoundTrip() throws {
        let root = try #require(JSONOutlineNode.parse(sample))
        let users = try #require(root.children().first { $0.key == "users" })
        let alice = try #require(users.children().first)
        let fields = alice.children()
        // Object keys render in sorted order: "active" before "name".
        #expect(fields.map(\.key) == ["active", "name"])
        #expect(fields.map(\.displayValue) == ["true", "\"Alice\""])
        let bob = try #require(users.children().last)
        let nullName = try #require(bob.children().first)
        #expect(nullName.kind == .null)
        #expect(nullName.displayValue == "null")
    }

    @Test
    func stringValuesEscapeQuotesAndNewlines() throws {
        let root = try #require(JSONOutlineNode.parse(#"{"line":"a \"quoted\" \n break"}"#))
        let field = try #require(root.children().first)
        #expect(field.displayValue == "\"a \\\"quoted\\\" \\n break\"")
    }

    @Test
    func scalarRootParsesWithNoChildren() {
        #expect(JSONOutlineNode.parse("42")?.kind == .number)
        #expect(JSONOutlineNode.parse("true")?.kind == .bool)
        #expect(JSONOutlineNode.parse("null")?.kind == .null)
        let scalar = JSONOutlineNode.parse("42")
        #expect(scalar?.isExpandable == false)
        #expect(scalar?.childCount == 0)
        #expect(scalar?.children().isEmpty == true)
    }

    @Test
    func invalidJSONFailsToParse() {
        #expect(JSONOutlineNode.parse(#"{"ok": tru"#) == nil)
        #expect(JSONOutlineNode.parse("plain text") == nil)
        #expect(JSONOutlineNode.parse("") == nil)
    }

    /// A document with thousands of nested leaves: the outline reports
    /// container counts without walking the subtree, and materializes the
    /// full array only when asked for its children.
    @Test
    func parsesLargeNestedDocument() throws {
        var items = ""
        for i in 0..<2_000 { items += "{\"i\":\(i)}," }
        let text = "{\"data\":[\(items.dropLast())]}"
        let root = try #require(JSONOutlineNode.parse(text))
        let data = try #require(root.children().first { $0.key == "data" })
        #expect(data.childCount == 2_000)
        #expect(data.children().count == 2_000)
        #expect(data.children()[0].childCount == 1)
    }
}

@Suite("JSONPrettyPrinter")
struct JSONPrettyPrinterTests {
    @Test
    func prettyPrintsSortedKeysWithNewlines() throws {
        let pretty = try #require(JSONPrettyPrinter.prettyPrinted(#"{"zebra":1,"alpha":{"b":2,"a":1}}"#))
        #expect(pretty.contains("\n"))
        #expect(pretty.contains("  "))
        // Sorted keys put alpha before zebra even though the document said otherwise.
        let alpha = try #require(pretty.range(of: "\"alpha\""))
        let zebra = try #require(pretty.range(of: "\"zebra\""))
        #expect(alpha.lowerBound < zebra.lowerBound)
    }

    @Test
    func scalarRootPrettyPrints() {
        #expect(JSONPrettyPrinter.prettyPrinted("42") == "42")
        #expect(JSONPrettyPrinter.prettyPrinted("\"hi\"") == "\"hi\"")
    }

    @Test
    func nonJSONReturnsNil() {
        #expect(JSONPrettyPrinter.prettyPrinted("<html>") == nil)
        #expect(JSONPrettyPrinter.prettyPrinted("") == nil)
    }
}

@Suite("HexDumper")
struct HexDumperTests {
    @Test
    func dumpsOffsetsHexAndAscii() {
        let dump = HexDumper.dump(Array("Hi!".utf8) + [0x00, 0xff])
        let lines = dump.split(separator: "\n").map(String.init)
        #expect(lines.count == 1)
        #expect(lines[0].hasPrefix("00000000"))
        #expect(lines[0].contains("48 69 21 00 ff"))
        // 0x00 and 0xff render as dots in the ASCII gutter.
        #expect(lines[0].contains("|Hi!..|"))
    }

    @Test
    func wrapsAtSixteenBytesPerLine() {
        let dump = HexDumper.dump(Array(repeating: UInt8(0x41), count: 33))
        let lines = dump.split(separator: "\n")
        #expect(lines.count == 3)
        #expect(lines[0].hasPrefix("00000000"))
        #expect(lines[1].hasPrefix("00000010"))
        #expect(lines[2].hasPrefix("00000020"))
    }

    @Test
    func truncatesPastTheByteLimitWithANote() {
        let dump = HexDumper.dump(Array(repeating: UInt8(7), count: 40), limit: 16)
        #expect(dump.contains("24 more bytes not shown"))
        #expect(dump.split(separator: "\n").count == 2)
    }

    @Test
    func emptyBytesDumpToEmptyString() {
        #expect(HexDumper.dump([]) == "")
    }
}

@Suite("BodyBytes")
struct BodyBytesTests {
    @Test
    func decodesBase64Body() {
        let bytes = BodyBytes.decode(from: Data([0x00, 0x01, 0x02, 0xfe]).base64EncodedString())
        #expect(bytes == [0x00, 0x01, 0x02, 0xfe])
    }

    @Test
    func decodesDataURLPayload() {
        let base64 = Data("tiny png".utf8).base64EncodedString()
        let bytes = BodyBytes.decode(from: "data:image/png;base64,\(base64)")
        #expect(bytes == Array("tiny png".utf8))
    }

    @Test
    func plainTextFallsBackToUTF8Bytes() {
        #expect(BodyBytes.decode(from: "plain text") == Array("plain text".utf8))
    }
}

@Suite("BodyFileSuggestion")
struct BodyFileSuggestionTests {
    @Test(arguments: [
        ("application/json; charset=utf-8", "json"),
        ("image/png", "png"),
        ("IMAGE/JPEG", "jpg"),
        ("text/html", "html"),
        ("text/plain", "txt"),
        ("application/octet-stream", "bin"),
        ("application/vnd.custom+json", "json"),
        ("image/x-targa", "png"),
        ("application/x-custom", "bin"),
        (nil, "txt"),
    ] as [(String?, String)])
    func suggestsExtensionFromContentType(_ contentType: String?, _ expected: String) {
        #expect(BodyFileSuggestion.fileExtension(forContentType: contentType) == expected)
    }
}
