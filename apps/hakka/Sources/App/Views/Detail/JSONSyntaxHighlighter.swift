import AppKit
import Foundation
import SwiftUI

/// Colors a pretty-printed JSON string by lexical scan: keys, strings,
/// numbers, and the `true`/`false`/`null` literals each get a hue; braces
/// and colons stay secondary. Escapes inside strings are honored so a
/// quoted `\"` never ends the token early.
enum JSONSyntaxHighlighter {
    static func attributed(_ json: String) -> AttributedString {
        var attributed = AttributedString(json)
        attributed.font = .system(.caption, design: .monospaced)
        attributed.foregroundColor = .primary

        var index = json.startIndex
        while index < json.endIndex {
            let character = json[index]
            if character == "\"" {
                index = colorStringToken(from: index, in: json, of: &attributed)
            } else if isNumberStart(character, after: index, in: json) {
                index = colorNumberToken(from: index, in: json, of: &attributed)
            } else if let literal = literalRange(at: index, in: json) {
                color(literal, in: &attributed, color: Palette.literal)
                index = literal.upperBound
            } else {
                index = json.index(after: index)
            }
        }
        return attributed
    }

    /// Colors one string token, then decides key vs. value by whether a
    /// `:` follows before the next non-whitespace character.
    private static func colorStringToken(
        from start: String.Index,
        in json: String,
        of attributed: inout AttributedString
    ) -> String.Index {
        var end = json.index(after: start)
        while end < json.endIndex {
            if json[end] == "\\" {
                end = json.index(end, offsetBy: 2, limitedBy: json.endIndex) ?? json.endIndex
                continue
            }
            if json[end] == "\"" { break }
            end = json.index(after: end)
        }
        let token = start..<min(json.index(after: end), json.endIndex)

        var lookahead = end < json.endIndex ? json.index(after: end) : end
        while lookahead < json.endIndex && json[lookahead].isWhitespace {
            lookahead = json.index(after: lookahead)
        }
        let isKey = lookahead < json.endIndex && json[lookahead] == ":"
        color(token, in: &attributed, color: isKey ? Palette.key : Palette.string)
        return token.upperBound
    }

    /// A number starts at a digit, or at `-` when a digit follows.
    private static func isNumberStart(_ character: Character, after index: String.Index, in json: String) -> Bool {
        if character.isNumber { return true }
        guard character == "-", let next = json.index(index, offsetBy: 1, limitedBy: json.endIndex),
              next < json.endIndex
        else { return false }
        return json[next].isNumber
    }

    private static func colorNumberToken(
        from start: String.Index,
        in json: String,
        of attributed: inout AttributedString
    ) -> String.Index {
        var end = start
        while end < json.endIndex {
            let next = json[end]
            if next.isNumber || next == "." || next == "e" || next == "E" || next == "+" || next == "-" {
                end = json.index(after: end)
            } else {
                break
            }
        }
        color(start..<end, in: &attributed, color: Palette.number)
        return end
    }

    /// Range of the bare literal (`true`/`false`/`null`) starting at `index`.
    private static func literalRange(at index: String.Index, in json: String) -> Range<String.Index>? {
        for literal in ["true", "false", "null"] {
            var end = index
            var matches = true
            for scalar in literal.unicodeScalars {
                guard end < json.endIndex, json[end].unicodeScalars.first == scalar else {
                    matches = false
                    break
                }
                end = json.index(after: end)
            }
            if matches { return index..<end }
        }
        return nil
    }

    private static func color(_ range: Range<String.Index>, in attributed: inout AttributedString, color: Color) {
        guard let lower = AttributedString.Index(range.lowerBound, within: attributed),
              let upper = AttributedString.Index(range.upperBound, within: attributed)
        else { return }
        attributed[lower..<upper].foregroundColor = color
    }

    private enum Palette {
        static let key = Color.purple
        static let string = Color.blue
        static let number = Color.orange
        static let literal = Color.pink
    }
}
