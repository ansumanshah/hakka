import Foundation

/// String-literal escaping shared by the code generators. Each target
/// language differs only in which quote character needs escaping — the
/// control-character set (`\`, newline, CR, tab) is identical across
/// JS/Swift/Python/Go string literals, so one function serves all four.
enum LanguageEscaping {
    static func escapeForQuotedString(_ s: String, quote: Character) -> String {
        var out = ""
        out.reserveCapacity(s.count)
        for ch in s {
            switch ch {
            case quote:
                out.append("\\")
                out.append(quote)
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default: out.append(ch)
            }
        }
        return out
    }

    /// POSIX single-quoted shell strings can't contain an escaped quote —
    /// the standard workaround is to close the quote, emit an escaped `'`,
    /// then reopen it: `it'\''s` -> `it` + `'\''` + `s`.
    static func escapeForShellSingleQuotes(_ s: String) -> String {
        s.replacingOccurrences(of: "'", with: "'\\''")
    }
}
