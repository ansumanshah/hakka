import Foundation
import HakkaCommon

/// Identifies "the same request" across two runs of one flow: `(HTTP
/// method, normalized path, ordinal)`, where `ordinal` is the 1-based count
/// of that (method, path) pair seen so far *within the same run*. Method +
/// path alone would collapse every call to a paginated list endpoint into
/// one entry; ordinal keeps repeat calls distinct so "the 2nd call to GET
/// /orders" in run A lines up with "the 2nd call to GET /orders" in run B
/// instead of being silently merged with the 1st or 3rd.
///
/// What this gets wrong, honestly:
/// - **Path normalization is a heuristic, not a schema.** An all-numeric
///   segment, a UUID, a 24-hex-char id, or any segment 8+ chars containing
///   both a letter and a digit is treated as an identifier and replaced
///   with `:id`. A stable numeric slug (`/products/00012345`) is
///   over-normalized into `/products/:id`; a stable alphanumeric SKU that
///   happens to look like a generated id gets the same treatment. Both
///   merge genuinely different resources into one correspondence key.
/// - **Ordinal matching assumes call count is stable.** If a middle call to
///   a repeated endpoint is added or removed between runs, every ordinal
///   after it shifts by one, so ordinal 3 in run A can end up paired with
///   what was really ordinal 4 in run B — reported as a "changed" pair
///   rather than the add/remove it actually is. Only a change in *total*
///   call count for that key surfaces correctly as an add or a remove.
public struct SessionRequestKey: Sendable, Equatable, Hashable, CustomStringConvertible {
    public let method: HttpMethod
    public let normalizedPath: String
    public let ordinal: Int

    public var description: String { "\(method.rawValue) \(normalizedPath) #\(ordinal)" }
}

enum SessionCorrespondence {
    struct Assigned {
        let key: SessionRequestKey
        let request: NetworkRequest
    }

    /// Assigns a `SessionRequestKey` to every request in run order. Ordinals
    /// are scoped to this call, so the same array run through this function
    /// twice always reproduces the same keys.
    static func assignKeys(_ requests: [NetworkRequest]) -> [Assigned] {
        var counts: [String: Int] = [:]
        return requests.map { request in
            let path = normalizedPath(from: request.url)
            let bucket = "\(request.method.rawValue) \(path)"
            let ordinal = (counts[bucket] ?? 0) + 1
            counts[bucket] = ordinal
            return Assigned(
                key: SessionRequestKey(method: request.method, normalizedPath: path, ordinal: ordinal),
                request: request,
            )
        }
    }

    static func normalizedPath(from urlString: String) -> String {
        let path = URL(string: urlString)?.path ?? urlString
        let segments = path.split(separator: "/", omittingEmptySubsequences: true)
        let normalized = segments.map { isLikelyIdentifier($0) ? ":id" : String($0) }
        return "/" + normalized.joined(separator: "/")
    }

    private static func isLikelyIdentifier(_ segment: Substring) -> Bool {
        if !segment.isEmpty, segment.allSatisfy(\.isNumber) { return true }
        if UUID(uuidString: String(segment)) != nil { return true }
        if segment.count == 24, segment.allSatisfy(\.isHexDigit) { return true }
        if segment.count >= 8, segment.contains(where: \.isNumber), segment.contains(where: \.isLetter) { return true }
        return false
    }

    /// Longest common subsequence of the two key lists, treated as opaque
    /// tokens — the same DP shape `LineDiff.compute` uses for lines of text,
    /// generalized to any `Hashable` element. Only the membership of the
    /// aligned subsequence is returned (not a full added/removed script)
    /// because correspondence, not text, is the caller's unit of comparison
    /// here: a key present in both lists but *outside* this set stayed
    /// paired to the same request, it just moved relative to every other
    /// pair — that's `reordered`, computed by the caller from this set.
    static func lcsAlign(_ before: [SessionRequestKey], _ after: [SessionRequestKey]) -> Set<SessionRequestKey> {
        let n = before.count
        let m = after.count
        guard n > 0, m > 0 else { return [] }

        var table = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)
        for i in stride(from: n - 1, through: 0, by: -1) {
            for j in stride(from: m - 1, through: 0, by: -1) {
                table[i][j] = before[i] == after[j]
                    ? table[i + 1][j + 1] + 1
                    : max(table[i + 1][j], table[i][j + 1])
            }
        }

        var aligned: Set<SessionRequestKey> = []
        var i = 0
        var j = 0
        while i < n, j < m {
            if before[i] == after[j] {
                aligned.insert(before[i])
                i += 1
                j += 1
            } else if table[i + 1][j] >= table[i][j + 1] {
                i += 1
            } else {
                j += 1
            }
        }
        return aligned
    }
}
