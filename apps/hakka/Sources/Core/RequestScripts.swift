import Foundation

/// A saved request's pre-request/post-response hooks (ADR 0010 phase 4.2).
///
/// Source is stored as `[String]` (one array element per line), not a single
/// `String`. A collection file is JSON, and `JSONEncoder`'s `.prettyPrinted`
/// output still renders embedded `\n` characters as an escaped `\n` inside
/// one quoted string — a multi-line script as a single `String` field would
/// land in the `.hakka` file as one long escaped blob on one line, exactly
/// the unreviewable diff shape this format's designers ruled out for every
/// other field (see `CollectionFileFormat`'s "reviewable, line-oriented"
/// doc comment). An array of lines keeps each source line its own JSON
/// array element, so `git diff` on a script edit reads the way a diff on
/// any other source file does. `preRequestSource`/`postResponseSource`
/// below are the editor- and runtime-facing join/split of that array;
/// nothing outside this type should touch `preRequestLines`/
/// `postResponseLines` directly.
public struct RequestScripts: Sendable, Codable, Equatable {
    public var preRequestLines: [String]
    public var postResponseLines: [String]

    public init(preRequestLines: [String] = [], postResponseLines: [String] = []) {
        self.preRequestLines = preRequestLines
        self.postResponseLines = postResponseLines
    }

    public var isEmpty: Bool { preRequestLines.isEmpty && postResponseLines.isEmpty }

    public var preRequestSource: String {
        get { preRequestLines.joined(separator: "\n") }
        set { preRequestLines = Self.split(newValue) }
    }

    public var postResponseSource: String {
        get { postResponseLines.joined(separator: "\n") }
        set { postResponseLines = Self.split(newValue) }
    }

    private static func split(_ text: String) -> [String] {
        text.isEmpty ? [] : text.components(separatedBy: "\n")
    }
}
