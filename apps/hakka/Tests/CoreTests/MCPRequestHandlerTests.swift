import Foundation
import Testing

@testable import HakkaServer

/// A trivial tool used only to isolate `MCPRequestHandler`'s dispatch logic
/// from the actual traffic/collection tools (which get their own test
/// files) — echoes its arguments back as the result payload.
private struct EchoTool: MCPTool {
    let name = "echo"
    let description = "Echoes its arguments back."
    let inputSchema: MCPValue = .object(["type": .string("object")])

    func call(_ arguments: MCPValue) async -> MCPToolResult {
        .json(arguments)
    }
}

/// Drives the real JSON-RPC surface end to end: encode a request body, run
/// it through `MCPRequestHandler.handle`, decode the response, assert on
/// its shape — never reaching into the handler's internals.
@Suite("MCPRequestHandler")
struct MCPRequestHandlerTests {
    private func makeHandler() -> MCPRequestHandler {
        MCPRequestHandler(registry: MCPToolRegistry(tools: [EchoTool()]))
    }

    private func request(_ json: String) -> Data { Data(json.utf8) }

    /// Unwraps `.response(data)`, failing the test if the handler decided
    /// this was a notification instead.
    private func decodedResponse(_ result: MCPHandleResult) throws -> MCPValue {
        guard case let .response(data) = result else {
            Issue.record("expected a response, got .noResponse")
            throw TestFailure.unexpectedNoResponse
        }
        return try JSONDecoder().decode(MCPValue.self, from: data)
    }

    private enum TestFailure: Error { case unexpectedNoResponse }

    // MARK: - initialize

    @Test("initialize echoes back a protocol version this server supports")
    func initializeEchoesSupportedVersion() async throws {
        let result = await makeHandler().handle(request(
            #"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}"#
        ))
        let response = try decodedResponse(result)
        #expect(response["id"] == .number(1))
        #expect(response["result"]?["protocolVersion"]?.stringValue == "2024-11-05")
        #expect(response["result"]?["serverInfo"]?["name"]?.stringValue == "hakka-desktop")
    }

    @Test("initialize falls back to the latest version for an unsupported request")
    func initializeFallsBackToLatest() async throws {
        let result = await makeHandler().handle(request(
            #"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}"#
        ))
        let response = try decodedResponse(result)
        #expect(response["result"]?["protocolVersion"]?.stringValue == MCPProtocolVersion.latest)
    }

    // MARK: - tools/list

    @Test("tools/list advertises every registered tool")
    func toolsListAdvertisesRegisteredTools() async throws {
        let result = await makeHandler().handle(request(#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#))
        let response = try decodedResponse(result)
        let names = response["result"]?["tools"]?.arrayValue?.compactMap { $0["name"]?.stringValue }
        #expect(names == ["echo"])
    }

    // MARK: - tools/call

    @Test("tools/call dispatches to the named tool and returns its content")
    func toolsCallDispatches() async throws {
        let result = await makeHandler().handle(request(
            #"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"x":1}}}"#
        ))
        let response = try decodedResponse(result)
        let text = response["result"]?["content"]?.arrayValue?.first?["text"]?.stringValue
        #expect(text == #"{"x":1}"#)
    }

    @Test("tools/call for an unknown tool is a JSON-RPC invalid-params error, not a tool result")
    func toolsCallUnknownToolIsProtocolError() async throws {
        let result = await makeHandler().handle(request(
            #"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nope"}}"#
        ))
        let response = try decodedResponse(result)
        #expect(response["error"]?["code"]?.intValue == MCPErrorCode.invalidParams)
        #expect(response["result"] == nil)
    }

    @Test("tools/call with no name is invalid params")
    func toolsCallMissingNameIsInvalidParams() async throws {
        let result = await makeHandler().handle(request(#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{}}"#))
        let response = try decodedResponse(result)
        #expect(response["error"]?["code"]?.intValue == MCPErrorCode.invalidParams)
    }

    // MARK: - protocol-level error paths

    @Test("malformed JSON is a parse error with a null id")
    func malformedJSONIsParseError() async throws {
        let result = await makeHandler().handle(request("not json at all {"))
        let response = try decodedResponse(result)
        #expect(response["error"]?["code"]?.intValue == MCPErrorCode.parseError)
        #expect(response["id"] == .null)
    }

    @Test("a JSON array instead of a Request object is Invalid Request, not a parse error")
    func nonObjectRequestIsInvalidRequest() async throws {
        let result = await makeHandler().handle(request("[1,2,3]"))
        let response = try decodedResponse(result)
        #expect(response["error"]?["code"]?.intValue == MCPErrorCode.invalidRequest)
    }

    @Test("wrong jsonrpc version is Invalid Request, and the id is still echoed back")
    func wrongJSONRPCVersionIsInvalidRequest() async throws {
        let result = await makeHandler().handle(request(#"{"jsonrpc":"1.0","id":9,"method":"tools/list"}"#))
        let response = try decodedResponse(result)
        #expect(response["error"]?["code"]?.intValue == MCPErrorCode.invalidRequest)
        #expect(response["id"] == .number(9))
    }

    @Test("an unknown method is Method Not Found")
    func unknownMethodIsMethodNotFound() async throws {
        let result = await makeHandler().handle(request(#"{"jsonrpc":"2.0","id":6,"method":"resources/list"}"#))
        let response = try decodedResponse(result)
        #expect(response["error"]?["code"]?.intValue == MCPErrorCode.methodNotFound)
    }

    // MARK: - notifications

    @Test("a request with no id is a notification: no response is sent")
    func notificationGetsNoResponse() async throws {
        let result = await makeHandler().handle(request(#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#))
        #expect(result == .noResponse)
    }

    @Test("a string id round-trips exactly")
    func stringIDRoundTrips() async throws {
        let result = await makeHandler().handle(request(#"{"jsonrpc":"2.0","id":"req-abc","method":"tools/list"}"#))
        let response = try decodedResponse(result)
        #expect(response["id"] == .string("req-abc"))
    }
}
