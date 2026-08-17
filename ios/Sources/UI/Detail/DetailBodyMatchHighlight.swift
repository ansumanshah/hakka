#if canImport(UIKit)
import HakkaCommon
import HakkaNetwork
import SwiftUI
import UIKit

// MARK: - MatchHighlightedBody
//
// See DetailBodyHelpers.swift for the split's overview. Not `private` —
// constructed from `BodyContentCard` in DetailBodyContentCard.swift.

/// Renders body text with every case-insensitive match of `query` highlighted
/// (dim amber `mark`), and the match at `activeIdx` (wrapped, mirroring web's
/// `clampedIdx`) in the brighter active highlight — same grammar as web's
/// BodySearch `<mark>` treatment, built via `AttributedString` run attributes
/// so backgrounds render (plain `Text` concatenation has no per-run background).
struct MatchHighlightedBody: View {
    let text: String
    let query: String
    let activeIdx: Int

    /// Case-insensitive, non-overlapping match ranges of `query` in `text`.
    static func matchRanges(in text: String, query: String) -> [Range<String.Index>] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !text.isEmpty else { return [] }
        var ranges: [Range<String.Index>] = []
        var cursor = text.startIndex
        while cursor < text.endIndex,
              let range = text.range(of: trimmed, options: [.caseInsensitive], range: cursor..<text.endIndex) {
            ranges.append(range)
            cursor = range.upperBound
        }
        return ranges
    }

    static func matchCount(in text: String, query: String) -> Int {
        matchRanges(in: text, query: query).count
    }

    var body: some View {
        Text(attributed)
            .font(.caption2.monospaced())
            .foregroundStyle(Theme.text)
    }

    private var attributed: AttributedString {
        var result = AttributedString(text)
        result.foregroundColor = Theme.text

        let ranges = Self.matchRanges(in: text, query: query)
        guard !ranges.isEmpty else { return result }
        let activeI = activeIdx % ranges.count

        for (i, range) in ranges.enumerated() {
            guard let attrRange = Range(range, in: result) else { continue }
            let isActive = i == activeI
            result[attrRange].backgroundColor = isActive ? Theme.warning : Theme.warning.opacity(0.35)
            if isActive {
                result[attrRange].foregroundColor = .black
                result[attrRange].inlinePresentationIntent = .stronglyEmphasized
            }
        }
        return result
    }
}
#endif // canImport(UIKit)
