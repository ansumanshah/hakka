import Foundation
import Testing
@testable import HakkaCore

@Suite("RequestSessionSpec")
struct RequestSessionSpecTests {
    @Test func encodesWebSocketUsingThePortableContract() throws {
        let value = RequestSessionSpec.webSocket(WebSocketSessionSpec(
            sendFrames: [WebSocketSessionFrame(data: "AQI=", isBinary: true)],
            maxFrames: 2,
            timeoutMs: 500,
        ))
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any]
        let webSocket = try #require(json?["webSocket"] as? [String: Any])
        #expect(webSocket["maxFrames"] as? Int == 2)
        #expect(webSocket["timeoutMs"] as? Int == 500)
        #expect(json?["sse"] == nil)
    }

    @Test func decodesSSEUsingThePortableContract() throws {
        let value = try JSONDecoder().decode(RequestSessionSpec.self, from: Data(#"{"sse":{"maxEvents":3,"timeoutMs":1000}}"#.utf8))
        #expect(value == .sse(SSESessionSpec(maxEvents: 3, timeoutMs: 1000)))
    }

    @Test func rejectsAmbiguousSession() {
        let data = Data(#"{"webSocket":{"sendFrames":[],"maxFrames":1,"timeoutMs":1},"sse":{"maxEvents":1,"timeoutMs":1}}"#.utf8)
        #expect(throws: (any Error).self) { try JSONDecoder().decode(RequestSessionSpec.self, from: data) }
    }

    @Test(arguments: [#"{}"#, #"{"webSocket":null}"#, #"{"sse":null}"#])
    func rejectsSessionWithoutExactlyOneProtocol(json: String) {
        #expect(throws: (any Error).self) {
            try JSONDecoder().decode(RequestSessionSpec.self, from: Data(json.utf8))
        }
    }
}
