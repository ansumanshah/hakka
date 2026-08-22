import HakkaCore
import Testing

@Suite("RedirectChain")
struct RedirectChainTests {
    @Test func noRedirectsYieldsNil()
    async throws {
        let chain = RedirectChain(redirectUrls: [], finalUrl: "https://example.com")
        #expect(chain == nil)
    }

    @Test func singleHopReadsAsTwoHops()
    async throws {
        let chain = RedirectChain(
            redirectUrls: ["https://example.com/old"],
            finalUrl: "https://example.com/new"
        )
        #expect(chain?.hops.count == 2)
        #expect(chain?.hops[0].url == "https://example.com/old")
        #expect(chain?.hops[0].isFinal == false)
        #expect(chain?.hops[1].url == "https://example.com/new")
        #expect(chain?.hops[1].isFinal == true)
    }

    @Test func fiveHopChainReadsEveryHopInOrder()
    async throws {
        let redirects = (1...5).map { "https://example.com/hop\($0)" }
        let chain = RedirectChain(redirectUrls: redirects, finalUrl: "https://example.com/final")
        #expect(chain?.hops.count == 6)
        #expect(chain?.hops.map(\.url) == redirects + ["https://example.com/final"])
        #expect(chain?.hops.map(\.index) == [0, 1, 2, 3, 4, 5])
        #expect(chain?.hops.dropLast().allSatisfy { $0.isFinal == false } == true)
        #expect(chain?.hops.last?.isFinal == true)
    }
}
