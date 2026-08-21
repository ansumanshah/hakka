import Foundation

/// Splits a URL into a base and decoded query items, and rejoins the two.
///
/// Deliberately hand-rolled instead of `URLComponents`: imported URLs
/// routinely carry `{{variable}}` placeholders (Postman/Bruno/Hakka's own
/// syntax), and those curly braces make `URLComponents(string:)` return nil
/// on some inputs since they're not valid RFC 3986 characters. Plain string
/// splitting has no such objection.
enum URLQuerySplitter {
    static func split(_ urlString: String) -> (base: String, items: [(name: String, value: String)]) {
        var s = Substring(urlString)
        if let hashIndex = s.firstIndex(of: "#") { s = s[s.startIndex ..< hashIndex] }
        guard let qIndex = s.firstIndex(of: "?") else { return (String(s), []) }
        let base = String(s[s.startIndex ..< qIndex])
        let queryString = s[s.index(after: qIndex)...]
        guard !queryString.isEmpty else { return (base, []) }

        let items = queryString.split(separator: "&", omittingEmptySubsequences: true).map { pair -> (String, String) in
            if let eqIndex = pair.firstIndex(of: "=") {
                let name = String(pair[pair.startIndex ..< eqIndex])
                let value = String(pair[pair.index(after: eqIndex)...])
                return (decode(name), decode(value))
            }
            return (decode(String(pair)), "")
        }
        return (base, items)
    }

    static func join(base: String, items: [(name: String, value: String)]) -> String {
        guard !items.isEmpty else { return base }
        let query = items.map { "\(encode($0.name))=\(encode($0.value))" }.joined(separator: "&")
        return "\(base)?\(query)"
    }

    static func encode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? s
    }

    private static func decode(_ s: String) -> String {
        s.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? s
    }

    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    )
}
