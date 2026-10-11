import CryptoKit
import Foundation
import HakkaCommon
import HakkaCore
import Testing

@testable import HakkaServer

private func summaryFixture(_ index: Int, url: String = "https://private-user:private-password@example.com:8443/private-path?token=private-query#private-fragment", status: Int? = 201, duration: Int64? = 42) -> NetworkRequest {
    NetworkRequest(
        id: "private-id-\(index)", url: url, method: .post, status: status,
        startTime: Int64(index), duration: duration,
        requestHeaders: ["Authorization": ["private-header"]],
        responseHeaders: ["Set-Cookie": ["private-cookie"]],
        requestBody: "private-request-body", responseBody: "private-response-body",
        error: "/Users/private-owner/private-error", correlationId: "private-correlation"
    )
}

private func summaryReference(_ index: Int) -> String {
    "sha256:" + SHA256.hash(data: Data("private-id-\(index)".utf8)).map { String(format: "%02x", $0) }.joined()
}

private actor SummaryCountingSource: MCPTrafficSource {
    private(set) var reads = 0
    func allRequests() async -> [NetworkRequest] { reads += 1; return [] }
    func request(id: String) async -> NetworkRequest? { nil }
}

private struct SummaryEmptyCollections: MCPCollectionDirectoryProvider {
    func collectionDirectories() async -> [URL] { [] }
}

@Suite("MCPListRequestSummariesTool")
struct MCPListRequestSummariesToolTests {
    @Test("native server registers the summary tool without opening a listener")
    func serverRegistration() async {
        let server = MCPServer(trafficSource: TrafficStore(), collectionDirectoryProvider: SummaryEmptyCollections())
        let tool = await server.registry.tool(named: "list_request_summaries")
        #expect(tool != nil)
        #expect(tool?.inputSchema["additionalProperties"] == .bool(false))
        #expect(tool?.inputSchema["properties"]?["limit"]?["maximum"]?.intValue == 50)
        #expect(tool?.inputSchema["properties"]?["offset"]?["maximum"]?.intValue == 1_000_000)
        #expect(await server.isRunning == false)
    }

    @Test("actual traffic store emits only bounded summaries and stable hashed references")
    func privateValuesStayInStore() async {
        let store = TrafficStore(capacity: 100)
        await store.append(contentsOf: (1...60).map { summaryFixture($0) })
        let tool = MCPListRequestSummariesTool(source: store)
        let result = await tool.call(.object([:]))
        let payload = decodeJSON(result)
        let summaries = payload["requests"]?.arrayValue ?? []
        #expect(!result.isError)
        #expect(payload["total"]?.intValue == 60)
        #expect(payload["offset"]?.intValue == 0)
        #expect(payload["count"]?.intValue == 25)
        #expect(payload["sourceIdentity"]?.stringValue == "unverified")
        #expect(payload["targetCorrelation"]?.stringValue == "unavailable")
        #expect(summaries.map { $0["reference"]?.stringValue } == (36...60).reversed().map(summaryReference))
        for summary in summaries {
            #expect(summary.objectValue?.keys.sorted() == ["durationMs", "method", "origin", "reference", "status"])
            #expect(summary["origin"]?.stringValue == "https://example.com:8443")
            #expect(summary["method"]?.stringValue == "POST")
            #expect(summary["status"]?.intValue == 201)
            #expect(summary["durationMs"]?.intValue == 42)
        }
        let text = result.content.first?["text"]?.stringValue ?? ""
        #expect(!text.contains("private"))
        #expect(!text.contains("/Users/"))
        #expect(!text.contains("Authorization"))
        #expect(!text.contains("Set-Cookie"))
        #expect(!text.contains("correlationId"))
        let repeatResult = await tool.call(.object([:]))
        #expect(decodeJSON(repeatResult) == payload)
        #expect(await store.count == 60)
    }

    @Test("pages newest-first and honors maximum, empty pages and ring-buffer ownership")
    func boundedPages() async {
        let store = TrafficStore(capacity: 60)
        await store.append(contentsOf: (1...70).map { summaryFixture($0) })
        let tool = MCPListRequestSummariesTool(source: store)
        let maximum = decodeJSON(await tool.call(.object(["limit": .number(50)])))
        #expect(maximum["total"]?.intValue == 60)
        #expect(maximum["count"]?.intValue == 50)
        let page = decodeJSON(await tool.call(.object(["limit": .number(2), "offset": .number(1)])))
        #expect(page["offset"]?.intValue == 1)
        #expect(page["requests"]?.arrayValue?.map { $0["reference"]?.stringValue } == [summaryReference(69), summaryReference(68)])
        let empty = decodeJSON(await tool.call(.object(["offset": .number(1_000_000)])))
        #expect(empty["total"]?.intValue == 60)
        #expect(empty["count"]?.intValue == 0)
        #expect(empty["requests"]?.arrayValue == [])
    }

    @Test("invalid argument shapes and values error before reading traffic")
    func invalidArguments() async {
        let source = SummaryCountingSource()
        let tool = MCPListRequestSummariesTool(source: source)
        let invalid: [MCPValue] = [
            .null, .array([]), .string("private-argument"),
            .object(["unknown": .string("private-argument")]),
            .object(["limit": .null]), .object(["limit": .bool(true)]),
            .object(["limit": .string("25")]), .object(["limit": .number(0)]),
            .object(["limit": .number(51)]), .object(["limit": .number(1.5)]),
            .object(["limit": .number(1e300)]), .object(["limit": .number(.infinity)]),
            .object(["offset": .number(-1)]), .object(["offset": .number(1_000_001)]),
            .object(["offset": .number(0.5)]), .object(["offset": .bool(false)]),
            .object(["offset": .string("0")]), .object(["offset": .null]),
            .object(["offset": .number(.nan)]),
        ]
        for arguments in invalid {
            let result = await tool.call(arguments)
            #expect(result.isError)
            #expect(decodeJSON(result)["error"]?.stringValue == "invalid_params")
            let text = result.content.first?["text"]?.stringValue ?? ""
            let hasPrivateArgument = text.contains("private-argument")
            #expect(hasPrivateArgument == false)
        }
        #expect(await source.reads == 0)
    }

    @Test("invalid origins and unavailable numeric facts are omitted", arguments: [
        "file:///Users/private-owner/private-file", "data:text/plain,private-payload",
        "https:///private-path", "not a URL", "ftp://example.com/private-path",
        "https://example.com:70000/private-path", "https://example.com/line\nprivate-path",
    ])
    func invalidFacts(url: String) async {
        let store = TrafficStore()
        await store.append(summaryFixture(1, url: url, status: 999, duration: -1))
        let payload = decodeJSON(await MCPListRequestSummariesTool(source: store).call(.object([:])))
        let summary = payload["requests"]?.arrayValue?.first
        #expect(summary?["origin"] == nil)
        #expect(summary?["status"] == nil)
        #expect(summary?["durationMs"] == nil)
    }

    @Test("missing and unrepresentable duration remains unavailable")
    func unavailableDuration() async {
        let store = TrafficStore()
        await store.append(summaryFixture(1, status: nil, duration: nil))
        await store.append(summaryFixture(2, status: 200, duration: Int64.max))
        let payload = decodeJSON(await MCPListRequestSummariesTool(source: store).call(.object([:])))
        let summaries = payload["requests"]?.arrayValue ?? []
        #expect(summaries.allSatisfy { $0["durationMs"] == nil })
        #expect(summaries.last?["status"] == nil)
    }
}
