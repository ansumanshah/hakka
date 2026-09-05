import Foundation
import Testing

@testable import HakkaServer

/// `MCPValue` is the currency type every other MCP test depends on — id
/// round-tripping in particular matters because a JSON-RPC client matches
/// a response back to its request by comparing `id` values byte-for-byte,
/// and `1.0` is not the same match as `1` to a strict client.
@Suite("MCPValue")
struct MCPValueTests {
    @Test("integer id round-trips without becoming a float")
    func integerIDRoundTrips() throws {
        let data = try JSONEncoder().encode(MCPValue.number(7))
        #expect(String(data: data, encoding: .utf8) == "7")
    }

    @Test("fractional numbers still encode as floats")
    func fractionalNumberEncodesAsFloat() throws {
        let data = try JSONEncoder().encode(MCPValue.number(1.5))
        #expect(String(data: data, encoding: .utf8) == "1.5")
    }

    @Test("decodes every JSON primitive shape")
    func decodesEveryShape() throws {
        let json = #"{"a":1,"b":"two","c":true,"d":null,"e":[1,"x",false],"f":{"nested":1}}"#
        let value = try JSONDecoder().decode(MCPValue.self, from: Data(json.utf8))
        #expect(value["a"]?.intValue == 1)
        #expect(value["b"]?.stringValue == "two")
        #expect(value["c"] == .bool(true))
        #expect(value["d"] == .null)
        #expect(value["e"] == .array([.number(1), .string("x"), .bool(false)]))
        #expect(value["f"]?["nested"]?.intValue == 1)
    }

    @Test("subscript on a non-object returns nil rather than trapping")
    func subscriptOnNonObjectIsNil() {
        #expect(MCPValue.string("x")["key"] == nil)
        #expect(MCPValue.array([]).objectValue == nil)
    }

    private struct Fixture: Encodable, Equatable {
        let id: String
        let count: Int
    }

    @Test("encoded(_:) round-trips an Encodable domain type through JSON")
    func encodedRoundTripsDomainType() {
        let value = MCPValue.encoded(Fixture(id: "abc", count: 3))
        #expect(value["id"]?.stringValue == "abc")
        #expect(value["count"]?.intValue == 3)
    }
}
