import Foundation
import Testing
@testable import HakkaCore

// MARK: - Fixtures

private func url(_ string: String) -> URL {
    URL(string: string)!
}

/// A synthetic response carrying only what the cookie path reads: a URL and
/// headers. Built offline — no request is ever sent.
private func httpResponse(url: String, headers: [String: String] = [:], status: Int = 200) -> HTTPURLResponse {
    HTTPURLResponse(
        url: URL(string: url)!,
        statusCode: status,
        httpVersion: "HTTP/1.1",
        headerFields: headers,
    )!
}

private func setCookieResponse(url: String, setCookie: String) -> HTTPURLResponse {
    httpResponse(url: url, headers: ["Set-Cookie": setCookie])
}

private func transportResponse(_ response: HTTPURLResponse) -> TransportResponse {
    TransportResponse(data: Data("{}".utf8), response: response)
}

private struct StubTransport: RequestTransport {
    let handler: @Sendable (URLRequest, Bool) async throws -> TransportResponse

    func execute(_ request: URLRequest, followRedirects: Bool) async throws -> TransportResponse {
        try await handler(request, followRedirects)
    }
}

// MARK: - CookieWire: Set-Cookie parsing and Cookie attachment

@Suite("CookieWire")
struct CookieWireTests {
    @Test func setCookieParsesNameValueAndAttributes() throws {
        let cookies = CookieWire.parseSetCookies(
            from: setCookieResponse(url: "https://api.example.com/", setCookie: "sid=abc; Path=/api; Secure; HttpOnly"),
        )
        let sid = try #require(cookies.first)
        #expect(sid.name == "sid")
        #expect(sid.value == "abc")
        #expect(sid.path == "/api")
        #expect(sid.isSecure)
        #expect(sid.isHTTPOnly)
    }

    @Test func commaJoinedSetCookieHeadersParseSeparately() {
        let cookies = CookieWire.parseSetCookies(
            from: setCookieResponse(url: "https://api.example.com/", setCookie: "a=1; Path=/, b=2; Path=/"),
        )
        #expect(cookies.map(\.name) == ["a", "b"])
        #expect(cookies.map(\.value) == ["1", "2"])
    }

    @Test func responseWithoutSetCookieYieldsNoCookies() {
        #expect(CookieWire.parseSetCookies(from: httpResponse(url: "https://api.example.com/")).isEmpty)
    }

    @Test func cookieHeaderValueJoinsPairsAndOmitsWhenEmpty() throws {
        let cookies = CookieWire.parseSetCookies(
            from: setCookieResponse(url: "https://api.example.com/", setCookie: "a=1; Path=/, b=2; Path=/"),
        )
        let headerValue = try #require(CookieWire.cookieHeaderValue(for: cookies))
        #expect(headerValue == "a=1; b=2")
        #expect(CookieWire.cookieHeaderValue(for: []) == nil)
    }

    @Test func attachCookiesSetsCookieHeaderOnBareRequest() throws {
        let cookies = CookieWire.parseSetCookies(from: setCookieResponse(url: "https://api.example.com/", setCookie: "sid=abc; Path=/"))
        let request = CookieWire.attachCookies(cookies, to: URLRequest(url: url("https://api.example.com/me")))
        #expect(try #require(request.value(forHTTPHeaderField: "Cookie")) == "sid=abc")
    }

    @Test func attachCookiesLeavesUserSetCookieHeaderUntouched() {
        var request = URLRequest(url: url("https://api.example.com/me"))
        request.setValue("manual=yes", forHTTPHeaderField: "Cookie")
        let cookies = CookieWire.parseSetCookies(from: setCookieResponse(url: "https://api.example.com/", setCookie: "sid=abc; Path=/"))

        let attached = CookieWire.attachCookies(cookies, to: request)

        #expect(attached.value(forHTTPHeaderField: "Cookie") == "manual=yes")
    }

    @Test func attachCookiesWithEmptyJarLeavesRequestUnchanged() {
        let request = URLRequest(url: url("https://api.example.com/me"))
        let attached = CookieWire.attachCookies([], to: request)
        #expect(attached.value(forHTTPHeaderField: "Cookie") == nil)
    }
}

// MARK: - CookieJar: store, scope, disable, clear, isolation

@Suite("CookieJar")
struct CookieJarTests {
    private func jarStoring(_ setCookie: String, responseURL: String) -> CookieJar {
        let jar = CookieJar()
        let response = setCookieResponse(url: responseURL, setCookie: setCookie)
        jar.setCookies(CookieWire.parseSetCookies(from: response), for: response.url!)
        return jar
    }

    @Test func setCookieFromSyntheticResponseLandsInJar() {
        let jar = jarStoring("sid=abc; Path=/", responseURL: "https://api.example.com/login")

        #expect(jar.allCookies().map(\.name) == ["sid"])
        #expect(jar.cookies(for: url("https://api.example.com/me")).map { "\($0.name)=\($0.value)" } == ["sid=abc"])
    }

    @Test func hostOnlyCookieMatchesOnlyItsExactHost() {
        let jar = jarStoring("sid=abc; Path=/", responseURL: "https://api.example.com/")

        #expect(jar.cookies(for: url("https://api.example.com/me")).count == 1)
        #expect(jar.cookies(for: url("https://other.example.com/")).isEmpty)
        #expect(jar.cookies(for: url("https://example.com/")).isEmpty)
    }

    @Test func domainCookieMatchesSubdomainsButNotOtherDomains() {
        let jar = jarStoring("wide=1; Domain=example.com; Path=/", responseURL: "https://api.example.com/")

        #expect(jar.cookies(for: url("https://api.example.com/")).map(\.name) == ["wide"])
        #expect(jar.cookies(for: url("https://other.example.com/")).map(\.name) == ["wide"])
        #expect(jar.cookies(for: url("https://other.net/")).isEmpty)
    }

    @Test func secureCookieIsNotSentOverPlainHTTP() {
        let jar = jarStoring("sec=1; Secure; Path=/", responseURL: "https://api.example.com/")

        #expect(jar.cookies(for: url("https://api.example.com/")).count == 1)
        #expect(jar.cookies(for: url("http://api.example.com/")).isEmpty)
    }

    @Test func pathScopedCookieMatchesOnlyPrefixPaths() {
        let jar = jarStoring("p=1; Path=/api", responseURL: "https://api.example.com/api")

        #expect(jar.cookies(for: url("https://api.example.com/api/users")).map(\.name) == ["p"])
        #expect(jar.cookies(for: url("https://api.example.com/home")).isEmpty)
    }

    @Test func disabledJarAttachesNothingButKeepsContents() {
        let jar = jarStoring("sid=abc; Path=/", responseURL: "https://api.example.com/")
        jar.setEnabled(false)

        #expect(jar.isEnabled == false)
        #expect(jar.cookies(for: url("https://api.example.com/me")).isEmpty)
        #expect(jar.allCookies().map(\.name) == ["sid"])

        jar.setEnabled(true)
        #expect(jar.cookies(for: url("https://api.example.com/me")).count == 1)
    }

    @Test func disabledJarStoresNothing() {
        let jar = CookieJar()
        jar.setEnabled(false)

        let response = setCookieResponse(url: "https://api.example.com/", setCookie: "sid=abc; Path=/")
        jar.setCookies(CookieWire.parseSetCookies(from: response), for: response.url!)

        #expect(jar.allCookies().isEmpty)
    }

    @Test func clearEmptiesTheJar() {
        let jar = jarStoring("a=1; Path=/", responseURL: "https://api.example.com/")
        jar.setCookies(CookieWire.parseSetCookies(from: setCookieResponse(url: "https://other.net/", setCookie: "b=2; Path=/")), for: url("https://other.net/"))
        #expect(jar.allCookies().count == 2)

        jar.clear()

        #expect(jar.allCookies().isEmpty)
        #expect(jar.cookies(for: url("https://api.example.com/")).isEmpty)
    }

    /// The jar must not read or write the process-wide `HTTPCookieStorage` —
    /// that isolation is the reason a private storage backs it. The marker
    /// domain is unique per run and deleted afterwards, so parallel tests and
    /// later runs are unaffected.
    @Test func jarIsIsolatedFromTheProcessWideCookieStorage() throws {
        let domain = "\(UUID().uuidString.prefix(8)).example.com"
        let isolated = url("https://\(domain)/")
        let marker = try #require(HTTPCookie(properties: [
            .domain: domain,
            .path: "/",
            .name: "sharedMarker",
            .value: "1",
            .expires: Date().addingTimeInterval(60),
        ]))
        HTTPCookieStorage.shared.setCookie(marker)
        defer { HTTPCookieStorage.shared.deleteCookie(marker) }

        let jar = jarStoring("jarMarker=1; Path=/", responseURL: "https://\(domain)/")

        #expect(HTTPCookieStorage.shared.cookies(for: isolated)?.map(\.name) == ["sharedMarker"])
        #expect(jar.cookies(for: isolated).map(\.name) == ["jarMarker"])
    }
}

// MARK: - RequestRunner: cookies across sends

@Suite("RequestRunner cookies")
struct RequestRunnerCookieTests {
    private func collection() -> Collection { Collection(name: "C") }

    @Test func setCookieResponseFeedsTheNextSend() async throws {
        let runner = RequestRunner(transport: StubTransport { request, _ in
            // Once the login response's Set-Cookie is stored, the next send
            // must carry it as a plain Cookie header; until then, answer with
            // the Set-Cookie response itself.
            if request.value(forHTTPHeaderField: "Cookie") == "sid=abc" {
                return transportResponse(httpResponse(url: "https://api.example.com/me"))
            }
            return transportResponse(setCookieResponse(url: "https://api.example.com/login", setCookie: "sid=abc; Path=/"))
        })

        _ = try await runner.run(
            RequestSpec(name: "Login", url: "https://api.example.com/login"),
            collection: collection(),
            scope: VariableScope(),
        )
        let result = try await runner.run(
            RequestSpec(name: "Me", url: "https://api.example.com/me"),
            collection: collection(),
            scope: VariableScope(),
        )

        #expect(result.record.requestHeaders["Cookie"] == ["sid=abc"])
    }

    @Test func userSetCookieHeaderWinsOverTheJar() async throws {
        let jar = CookieJar()
        jar.setCookies(
            CookieWire.parseSetCookies(from: setCookieResponse(url: "https://api.example.com/", setCookie: "sid=abc; Path=/")),
            for: url("https://api.example.com/"),
        )
        let runner = RequestRunner(
            transport: StubTransport { request, _ in
                #expect(request.value(forHTTPHeaderField: "Cookie") == "manual=yes")
                return transportResponse(httpResponse(url: "https://api.example.com/me"))
            },
            cookies: jar,
        )

        let request = RequestSpec(
            name: "R",
            url: "https://api.example.com/me",
            headers: [HeaderPair(name: "Cookie", value: "manual=yes")],
        )
        let result = try await runner.run(request, collection: collection(), scope: VariableScope())

        #expect(result.record.requestHeaders["Cookie"] == ["manual=yes"])
    }

    @Test func disabledJarSendsNoCookieHeader() async throws {
        let jar = CookieJar()
        jar.setCookies(
            CookieWire.parseSetCookies(from: setCookieResponse(url: "https://api.example.com/", setCookie: "sid=abc; Path=/")),
            for: url("https://api.example.com/"),
        )
        jar.setEnabled(false)
        let runner = RequestRunner(
            transport: StubTransport { request, _ in
                #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
                return transportResponse(httpResponse(url: "https://api.example.com/me"))
            },
            cookies: jar,
        )

        let result = try await runner.run(
            RequestSpec(name: "R", url: "https://api.example.com/me"),
            collection: collection(),
            scope: VariableScope(),
        )

        #expect(result.record.requestHeaders["Cookie"] == nil)
    }
}
