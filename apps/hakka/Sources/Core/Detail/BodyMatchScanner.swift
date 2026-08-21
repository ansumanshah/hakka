import Foundation

/// One case-insensitive match of a body search query, as UTF-8 offset pairs
/// into the scanned text.
public struct BodyMatch: Sendable, Equatable {
    /// Offset of the first character of the match.
    public let start: Int
    /// Number of matched characters (equals the query's length).
    public let count: Int

    public init(start: Int, count: Int) {
        self.start = start
        self.count = count
    }

    public var end: Int { start + count }
}

/// Finds case-insensitive substring matches in body text for the
/// find-next/previous affordance in the raw and pretty viewers. Scans only
/// the text it is handed — callers pass the capped window, since matches
/// beyond what is displayed could never be shown.
public enum BodyMatchScanner {
    public static func scan(query: String, in text: String) -> [BodyMatch] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !text.isEmpty else { return [] }

        let haystack = text.lowercased()
        let needle = trimmed.lowercased()
        let needleCount = trimmed.count

        var matches: [BodyMatch] = []
        var searchStart = haystack.startIndex
        while let found = haystack.range(of: needle, range: searchStart..<haystack.endIndex) {
            matches.append(BodyMatch(
                start: haystack.distance(from: haystack.startIndex, to: found.lowerBound),
                count: needleCount
            ))
            searchStart = found.upperBound
        }
        return matches
    }
}
