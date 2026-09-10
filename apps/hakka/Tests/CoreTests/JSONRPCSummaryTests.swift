import Testing

@testable import HakkaCore

@Suite("JSONRPCSummary")
struct JSONRPCSummaryTests {
    @Test func readsRequestResponseFactsWithoutPayloads() throws {
        let summary = try #require(JSONRPCSummary(
            requestBody: #"{"jsonrpc":"2.0","method":"catalog.search","params":{"query":"café"},"id":"request-7"}"#,
            responseBody: #"{"jsonrpc":"2.0","result":{"items":[1,2,3]},"id":"request-7"}"#
        ))

        let request = try #require(summary.request?.messages.first)
        #expect(request.method == "catalog.search")
        #expect(request.id == .string("request-7"))
        #expect(!request.isNotification)

        let response = try #require(summary.response?.messages.first)
        #expect(response.hasResult)
        #expect(response.errorCode == nil)
        #expect(response.id == .string("request-7"))
    }

    @Test func readsNotificationsAndErrorCodes() throws {
        let summary = try #require(JSONRPCSummary(
            requestBody: #"{"jsonrpc":"2.0","method":"inventory.changed","params":["Δ"]}"#,
            responseBody: #"{"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found","data":{"private":"ignored"}},"id":null}"#
        ))

        let request = try #require(summary.request?.messages.first)
        #expect(request.isNotification)
        #expect(request.id == nil)
        let response = try #require(summary.response?.messages.first)
        #expect(!response.hasResult)
        #expect(response.errorCode == -32601)
        #expect(response.id == .null)
    }

    @Test func readsBoundedBatches() throws {
        let summary = try #require(JSONRPCSummary(
            requestBody: #"[{"jsonrpc":"2.0","method":"first","id":1},{"jsonrpc":"2.0","method":"second"}]"#,
            responseBody: #"[{"jsonrpc":"2.0","result":true,"id":1},{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unavailable"},"id":"two"}]"#
        ))

        #expect(summary.request?.isBatch == true)
        #expect(summary.request?.messageCount == 2)
        #expect(summary.request?.messages[0].id == .number("1"))
        #expect(summary.request?.messages[1].isNotification == true)
        #expect(summary.response?.isBatch == true)
        #expect(summary.response?.messages.map(\.errorCode) == [nil, -32001])
    }

    @Test func rejectsFalsePositivesAndMalformedProtocolShapes() {
        #expect(JSONRPCSummary(requestBody: #"{"jsonrpc":"1.0","method":"legacy","id":1}"#, responseBody: nil) == nil)
        #expect(JSONRPCSummary(requestBody: #"{"jsonrpc":"2.0","method":42,"id":1}"#, responseBody: nil) == nil)
        #expect(JSONRPCSummary(requestBody: #"{"jsonrpc":"2.0","method":"call","params":"not structured","id":1}"#, responseBody: nil) == nil)
        #expect(JSONRPCSummary(requestBody: nil, responseBody: #"{"jsonrpc":"2.0","result":1,"error":{"code":1,"message":"both"},"id":1}"#) == nil)
        #expect(JSONRPCSummary(requestBody: nil, responseBody: #"{"jsonrpc":"2.0","error":{"code":1.5,"message":"fraction"},"id":1}"#) == nil)
        #expect(JSONRPCSummary(requestBody: nil, responseBody: #"{"jsonrpc":"2.0","result":1}"#) == nil)
        #expect(JSONRPCSummary(requestBody: "[]", responseBody: nil) == nil)
        #expect(JSONRPCSummary(requestBody: #"[{"jsonrpc":"2.0","method":"call"},42]"#, responseBody: nil) == nil)
        #expect(JSONRPCSummary(requestBody: "{", responseBody: nil) == nil)
    }

    @Test func rejectsBooleanIdentifiersAndErrorCodes() {
        #expect(JSONRPCSummary(requestBody: #"{"jsonrpc":"2.0","method":"call","id":true}"#, responseBody: nil) == nil)
        #expect(JSONRPCSummary(requestBody: nil, responseBody: #"{"jsonrpc":"2.0","result":null,"id":false}"#) == nil)
        #expect(JSONRPCSummary(requestBody: nil, responseBody: #"{"jsonrpc":"2.0","error":{"code":true,"message":"bad"},"id":1}"#) == nil)
    }

    @Test func rejectsOversizedBodiesAndBatches() {
        let oversized = "{\"jsonrpc\":\"2.0\",\"method\":\"call\",\"id\":1,\"params\":{\"padding\":\"" + String(repeating: "x", count: 128) + "\"}}"
        #expect(JSONRPCSummary(requestBody: oversized, responseBody: nil, maximumBodyBytes: 32) == nil)

        let unicode = #"{"jsonrpc":"2.0","method":"café","id":1}"#
        #expect(JSONRPCSummary(requestBody: unicode, responseBody: nil, maximumBodyBytes: unicode.utf8.count - 1) == nil)

        let messages = (0...32).map { #"{"jsonrpc":"2.0","method":"call","id":\#($0)}"# }.joined(separator: ",")
        #expect(JSONRPCSummary(requestBody: "[\(messages)]", responseBody: nil, maximumBatchMessages: 32) == nil)
    }
}
