import Foundation

/// Parses NUL-separated porcelain v2 records without altering filename bytes.
enum GitStatusParser {
    static func parse(_ output: String) -> GitStatus {
        var branch: String?
        var entries: [GitStatusEntry] = []

        var records = output.split(separator: "\0", omittingEmptySubsequences: false).makeIterator()
        while let rawLine = records.next() {
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
                let originalPath = records.next().map(String.init)
                if let entry = parseRenamed(line, originalPath: originalPath) { entries.append(entry) }
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

    /// `2 XY sub mH mI mW hH hI Xscore path` — 9 fixed fields,
    /// then the original path in the next NUL-separated record.
    private static func parseRenamed(_ line: String, originalPath: String?) -> GitStatusEntry? {
        let parts = line.split(separator: " ", maxSplits: 9, omittingEmptySubsequences: true)
        guard parts.count == 10, let (indexStatus, worktreeStatus) = xy(parts[1]) else { return nil }
        guard let originalPath, !originalPath.isEmpty else { return nil }
        return GitStatusEntry(
            path: String(parts[9]),
            originalPath: originalPath,
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
