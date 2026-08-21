import Foundation

/// The wire-format half of cookie handling — how `Set-Cookie` responses
/// become stored cookies and how stored cookies become a request `Cookie`
/// header. Pure functions over `HTTPURLResponse`/`URLRequest` values so tests
/// drive them with synthetic responses and never touch the network.
/// `CookieJar` is the who-holds-them half.
enum CookieWire {
    /// Cookies a response's `Set-Cookie` headers describe, parsed by the
    /// platform's cookie parser with the response URL as context — host-only
    /// cookies scope to the exact response host, `Domain=` cookies to the
    /// domain suffix. The parser owns the attribute grammar (expiry dates
    /// containing commas, quoted values, comma-joined headers), so this stays
    /// a thin pass-through rather than a second cookie grammar.
    ///
    /// Responses with no URL carry no scoping context, so they yield nothing.
    /// Known limit: the runner sees only the final response of a redirect
    /// chain, so `Set-Cookie` on intermediate 3xx hops is not captured.
    static func parseSetCookies(from response: HTTPURLResponse) -> [HTTPCookie] {
        guard let url = response.url else { return [] }
        var fields: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let name = key as? String else { continue }
            fields[name] = String(describing: value)
        }
        return HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
    }

    /// The `Cookie` header value the given cookies produce — nil when there
    /// are none, so callers skip the header instead of sending an empty one.
    static func cookieHeaderValue(for cookies: [HTTPCookie]) -> String? {
        guard cookies.isEmpty == false else { return nil }
        return cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    /// `request` with `cookies` attached as its `Cookie` header. A `Cookie`
    /// header already on the request — typed by the user or imported from
    /// `curl -b` — always wins; the jar never rewrites an explicit choice.
    /// Nothing is attached when there are no cookies to send.
    static func attachCookies(_ cookies: [HTTPCookie], to request: URLRequest) -> URLRequest {
        guard let headerValue = cookieHeaderValue(for: cookies),
              request.value(forHTTPHeaderField: "Cookie") == nil
        else { return request }
        var request = request
        request.setValue(headerValue, forHTTPHeaderField: "Cookie")
        return request
    }
}
