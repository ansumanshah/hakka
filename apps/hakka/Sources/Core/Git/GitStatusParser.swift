import Foundation

/// Parses `git status --porcelain=v2 --branch` output into `GitStatus`.
///
/// Deliberately the line-oriented format, not `-z`: `-z` NUL-separates
/// records (and, for renames, appends the original path as a *second*
/// NUL-terminated token with no header of its own), which is unambiguous
/// but means tracking "the next token belongs to the previous record"
/// across the whole stream. The line format keeps a rename's two paths on
/// one line (`path<TAB>origPath`), so each line parses independently. The
/// trade-off: a path containing a literal newline is not representable
/// here (rare in practice, and git itself C-quotes such paths in this mode
/// rather than emitting a raw newline, so this is a correctness edge case,
/// not a security one).
enum GitStatusParser {
    static func parse(_ output: String) -> GitStatus {
        var branch: String?
        var entries: [GitStatusEntry] = []

        for rawLine in output.split(separator: "\n", omittingEmptySubsequences: true) {
            let line = String(rawLine)
            guard let marker = line.first else { continue }
            switch marker {
            case "#":
                if line.hasPrefix("# branch.head ") {
                    let name = String(line.dropFirst("# branch.head ".count))
                    branch = name == "(detached)" ? nil : name
                }
            case "1":
                if let entry = parseOrdinary(line) { entries.append(entry) }
            case "2":
                if let entry = parseRenamed(line) { entries.append(entry) }
            case "u":
                if let entry = parseUnmerged(line) { entries.append(entry) }
            case "?":
                entries.append(GitStatusEntry(path: String(line.dropFirst(2)), indexStatus: "?", worktreeStatus: "?"))
            case "!":
                entries.append(GitStatusEntry(path: String(line.dropFirst(2)), indexStatus: "!", worktreeStatus: "!"))
            default:
                continue
            }
        }
        return GitStatus(branch: branch, entries: entries)
    }

    /// `1 XY sub mH mI mW hH hI path` — 8 fixed fields, then the path.
    private static func parseOrdinary(_ line: String) -> GitStatusEntry? {
        let parts = line.split(separator: " ", maxSplits: 8, omittingEmptySubsequences: true)
        guard parts.count == 9, let (indexStatus, worktreeStatus) = xy(parts[1]) else { return nil }
        return GitStatusEntry(path: String(parts[8]), indexStatus: indexStatus, worktreeStatus: worktreeStatus)
    }

    /// `2 XY sub mH mI mW hH hI Xscore path<TAB>origPath` — 9 fixed fields,
    /// then `path` and `origPath` sharing the final field, tab-separated.
    private static func parseRenamed(_ line: String) -> GitStatusEntry? {
        let parts = line.split(separator: " ", maxSplits: 9, omittingEmptySubsequences: true)
        guard parts.count == 10, let (indexStatus, worktreeStatus) = xy(parts[1]) else { return nil }
        let pieces = parts[9].split(separator: "\t", maxSplits: 1, omittingEmptySubsequences: false)
        guard pieces.count == 2 else { return nil }
        return GitStatusEntry(
            path: String(pieces[0]),
            originalPath: String(pieces[1]),
            indexStatus: indexStatus,
            worktreeStatus: worktreeStatus,
        )
    }

    /// `u XY sub m1 m2 m3 mW h1 h2 h3 path` — 10 fixed fields, then the path.
    private static func parseUnmerged(_ line: String) -> GitStatusEntry? {
        let parts = line.split(separator: " ", maxSplits: 10, omittingEmptySubsequences: true)
        guard parts.count == 11, let (indexStatus, worktreeStatus) = xy(parts[1]) else { return nil }
        return GitStatusEntry(path: String(parts[10]), indexStatus: indexStatus, worktreeStatus: worktreeStatus)
    }

    private static func xy(_ field: Substring) -> (Character, Character)? {
        guard field.count == 2 else { return nil }
        return (field[field.startIndex], field[field.index(after: field.startIndex)])
    }
}
