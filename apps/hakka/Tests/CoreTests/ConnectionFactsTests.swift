import HakkaCore
import Testing

@Suite("ConnectionFacts")
struct ConnectionFactsTests {
    @Test func noFactsYieldsNil()
    async throws {
        let facts = ConnectionFacts(networkProtocol: nil, tlsVersion: nil, cipherSuite: nil)
        #expect(facts == nil)
    }

    @Test func anySingleFactIsEnough()
    async throws {
        #expect(ConnectionFacts(networkProtocol: "h2", tlsVersion: nil, cipherSuite: nil) != nil)
        #expect(ConnectionFacts(networkProtocol: nil, tlsVersion: "TLSv1.3", cipherSuite: nil) != nil)
        #expect(ConnectionFacts(networkProtocol: nil, tlsVersion: nil, cipherSuite: "AES_128_GCM_SHA256") != nil)
    }

    @Test func carriesAllThreeValuesThrough()
    async throws {
        let facts = ConnectionFacts(
            networkProtocol: "h2",
            tlsVersion: "TLSv1.3",
            cipherSuite: "AES_128_GCM_SHA256"
        )
        #expect(facts?.networkProtocol == "h2")
        #expect(facts?.tlsVersion == "TLSv1.3")
        #expect(facts?.cipherSuite == "AES_128_GCM_SHA256")
    }
}
