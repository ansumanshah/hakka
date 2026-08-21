import Foundation

/// Pulls the operation definitions (`query`/`mutation`/`subscription`, each
/// with an optional name) out of a GraphQL document's source text, so the
/// editor can offer an operation-name picker without a real GraphQL parser
/// or a third-party dependency — this only needs to find where operations
/// start, not validate the document.
public enum GraphQLOperationParser {
    /// One `query`/`mutation`/`subscription` definition found at the top
    /// level of the document. `name` is nil for an anonymous operation.
    public struct Operation: Sendable, Equatable {
        public let keyword: String
        public let name: String?

        public init(keyword: String, name: String?) {
            self.keyword = keyword
            self.name = name
        }
    }

    /// Returns every named or anonymous operation definition in `source`, in
    /// document order.
    public static func operations(in source: String) -> [Operation] {
        scan(mask(Array(source)))
    }

    /// Convenience for the picker: only the names worth choosing between.
    /// Anonymous operations aren't selectable (there's no `operationName`
    /// value that would identify them), so they're dropped here even though
    /// `operations(in:)` reports them.
    public static func namedOperations(in source: String) -> [String] {
        operations(in: source).compactMap(\.name)
    }

    // MARK: - Masking

    /// Blanks out the contents of `#` comments and string literals (both
    /// `"..."` and block `"""..."""`) while leaving every other character in
    /// place, so the scan below can never mistake the word `query` sitting
    /// inside a string default value, or a `{`/`}` inside one, for real
    /// document structure.
    private static func mask(_ chars: [Character]) -> [Character] {
        var out = chars
        var i = 0
        let n = out.count
        while i < n {
            switch out[i] {
            case "#":
                while i < n, out[i] != "\n" { out[i] = " "; i += 1 }
            case "\"" where i + 2 < n && out[i + 1] == "\"" && out[i + 2] == "\"":
                out[i] = " "; out[i + 1] = " "; out[i + 2] = " "
                i += 3
                while i < n {
                    if out[i] == "\"", i + 2 < n, out[i + 1] == "\"", out[i + 2] == "\"" {
                        out[i] = " "; out[i + 1] = " "; out[i + 2] = " "
                        i += 3
                        break
                    }
                    out[i] = " "
                    i += 1
                }
            case "\"":
                out[i] = " "
                i += 1
                while i < n, out[i] != "\"" {
                    if out[i] == "\\", i + 1 < n {
                        out[i] = " "; out[i + 1] = " "
                        i += 2
                        continue
                    }
                    out[i] = " "
                    i += 1
                }
                if i < n { out[i] = " "; i += 1 }
            default:
                i += 1
            }
        }
        return out
    }

    // MARK: - Scanning

    /// Operations can't nest inside each other in a valid document, so a
    /// keyword is only treated as starting a new operation when it appears
    /// at brace depth 0 — this is what keeps a field literally named `query`
    /// (`{ query { ... } }`) from being misread as a second operation.
    private static func scan(_ masked: [Character]) -> [Operation] {
        var operations: [Operation] = []
        var depth = 0
        var i = 0
        let n = masked.count
        while i < n {
            let c = masked[i]
            if c == "{" { depth += 1; i += 1; continue }
            if c == "}" { depth -= 1; i += 1; continue }
            if depth == 0, isIdentifierStart(c) {
                let (word, afterWord) = readIdentifier(masked, from: i)
                guard word == "query" || word == "mutation" || word == "subscription" else {
                    i = afterWord
                    continue
                }
                var j = skipWhitespace(masked, from: afterWord)
                var name: String?
                if j < n, isIdentifierStart(masked[j]) {
                    let (nameWord, afterName) = readIdentifier(masked, from: j)
                    name = nameWord
                    j = afterName
                }
                operations.append(Operation(keyword: word, name: name))
                i = j
                continue
            }
            i += 1
        }
        return operations
    }

    private static func isIdentifierStart(_ c: Character) -> Bool {
        c.isLetter || c == "_"
    }

    private static func isIdentifierContinuation(_ c: Character) -> Bool {
        c.isLetter || c.isNumber || c == "_"
    }

    private static func readIdentifier(_ chars: [Character], from start: Int) -> (String, Int) {
        var end = start
        while end < chars.count, isIdentifierContinuation(chars[end]) { end += 1 }
        return (String(chars[start..<end]), end)
    }

    private static func skipWhitespace(_ chars: [Character], from start: Int) -> Int {
        var i = start
        while i < chars.count, chars[i].isWhitespace { i += 1 }
        return i
    }
}
