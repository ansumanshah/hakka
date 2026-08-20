import Foundation

/// Minimal POSIX-ish shell tokenizer: honors single/double quotes and
/// backslash escapes outside quotes. Not a full shell grammar — no `$()`,
/// no globbing, no variable expansion — because the only input this parses
/// is a copy-pasted `curl` command, not an arbitrary shell script.
enum ShellTokenizer {
    static func joinLineContinuations(_ input: String) -> String {
        input
            .replacingOccurrences(of: "\\\r\n", with: " ")
            .replacingOccurrences(of: "\\\n", with: " ")
    }

    static func tokenize(_ input: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        var hasToken = false
        var inSingle = false
        var inDouble = false
        let chars = Array(input)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if inSingle {
                if c == "'" { inSingle = false } else { current.append(c) }
            } else if inDouble {
                if c == "\"" {
                    inDouble = false
                } else if c == "\\", i + 1 < chars.count, chars[i + 1] == "\"" {
                    current.append("\"")
                    i += 1
                } else {
                    current.append(c)
                }
            } else if c == "'" {
                inSingle = true
                hasToken = true
            } else if c == "\"" {
                inDouble = true
                hasToken = true
            } else if c.isWhitespace {
                if hasToken {
                    tokens.append(current)
                    current = ""
                    hasToken = false
                }
            } else if c == "\\", i + 1 < chars.count {
                current.append(chars[i + 1])
                hasToken = true
                i += 1
            } else {
                current.append(c)
                hasToken = true
            }
            i += 1
        }
        if hasToken { tokens.append(current) }
        return tokens
    }
}
