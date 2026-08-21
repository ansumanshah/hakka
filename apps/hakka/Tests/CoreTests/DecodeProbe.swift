import Foundation
import HakkaCommon
import Testing
@testable import HakkaServer

/// The wire contract (`packages/hakka-core/src/model/types.ts`) requires only
/// `id`, `url`, `method` and `startTime`. Swift's synthesized decoder required
/// every non-optional stored property too, so real SDK payloads that omitted
/// `redirectCount`, `requestBodySize`, `source` or the header maps failed to
/// decode and were dropped from the traffic list without a trace. These pin
/// the contract from the desktop side.
@Suite("NetworkRequest wire tolerance")
struct NetworkRequestWireToleranceTests {
    /// Exactly the four fields the TypeScript type marks as required.
    private let minimal = #"{"id":"r1","url":"https://a.test/x","method":"GET","startTime":1787323000000}"#

    @Test func aMinimalPayloadDecodes() throws {
        let record = try JSONDecoder().decode(NetworkRequest.self, from: Data(minimal.utf8))

        #expect(record.id == "r1")
        #expect(record.redirectCount == 0)
        #expect(record.requestHeaders.isEmpty)
        #expect(record.requestBodySize == 0)
    }

    @Test func aMinimalFrameReachesTheTrafficStream() throws {
        let frame = try #require(parseBridgeFrame(#"{"type":"request","payload":\#(minimal)}"#))

        #expect(frame.request != nil, "a record the contract calls valid must not be dropped")
    }

    @Test func aPayloadMissingTheRequiredFourIsStillRejected() {
        let noUrl = #"{"id":"r1","method":"GET","startTime":1}"#

        #expect(throws: (any Error).self) {
            try JSONDecoder().decode(NetworkRequest.self, from: Data(noUrl.utf8))
        }
    }

    @Test func aFullyPopulatedPayloadStillRoundTrips() throws {
        let original = NetworkRequest(id: "r2", url: "https://b.test", method: .post, status: 201, startTime: 42, duration: 7)
        let data = try JSONEncoder().encode(original)

        #expect(try JSONDecoder().decode(NetworkRequest.self, from: data) == original)
    }
}
