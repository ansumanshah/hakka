import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// `DetailTab.visible(for:)` gates the Cookies tab on whether the record
/// actually carried a cookie on either side — most requests carry none, so
/// the tab must not appear as an always-empty distraction.
@Suite("DetailTab visible tabs")
struct DetailTabTests {
    private func request(requestHeaders: [String: [String]] = [:], responseHeaders: [String: [String]] = [:]) -> NetworkRequest {
        NetworkRequest(
            url: "https://api.example.com/",
            method: .get,
            status: 200,
            startTime: 0,
            requestHeaders: requestHeaders,
            responseHeaders: responseHeaders,
        )
    }

    @Test func cookiesTabHiddenWithNoCookiesEitherSide() {
        let tabs = DetailTab.visible(for: request())
        #expect(!tabs.contains(.cookies))
    }

    @Test func cookiesTabAppearsWhenRequestCarriesACookieHeader() {
        let tabs = DetailTab.visible(for: request(requestHeaders: ["Cookie": ["sid=abc"]]))
        #expect(tabs.contains(.cookies))
    }

    @Test func cookiesTabAppearsWhenResponseSetsACookie() {
        let tabs = DetailTab.visible(for: request(responseHeaders: ["Set-Cookie": ["sid=abc; Path=/"]]))
        #expect(tabs.contains(.cookies))
    }

    @Test func cookiesTabIsLastWhenBothSseAndCookiesApply() {
        let tabs = DetailTab.visible(for: request(
            requestHeaders: ["Cookie": ["sid=abc"]],
            responseHeaders: ["Content-Type": ["text/event-stream"]],
        ))
        #expect(tabs == [.overview, .request, .response, .timing, .sse, .cookies])
    }
}
