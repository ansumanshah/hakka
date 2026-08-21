/// A single line-diff entry, one per line of the compared text.
public enum LineDiffEntry: Sendable, Equatable {
    case unchanged(String)
    case added(String)
    case removed(String)
}

/// Line-level diff between two strings — the body-diff half of `RequestDiff`.
///
/// Classic LCS (longest common subsequence) dynamic program: O(n·m) in line
/// count, which is also O(n·m) in *memory* for the table. The SDK caps body
/// bytes, but the desktop server's own wire limit is 8MB per frame, and a
/// body of `"x\n"` repeated is two bytes per line — so a pair of large bodies
/// can imply a table of billions of entries. `maxTableCells` bounds that; past
/// it the comparison degrades to whole-body replace, which is honest (the
/// bodies differ, here they are) rather than an out-of-memory kill.
public enum LineDiff {
    /// Roughly 64M cells — a few hundred MB at 8 bytes each, still far past
    /// any body a person would read line by line.
    static let maxTableCells = 64 * 1024 * 1024

    public static func compute(old: String, new: String) -> [LineDiffEntry] {
        let oldLines = old.isEmpty ? [] : old.components(separatedBy: "\n")
        let newLines = new.isEmpty ? [] : new.components(separatedBy: "\n")
        guard !oldLines.isEmpty || !newLines.isEmpty else { return [] }

        let n = oldLines.count
        let m = newLines.count

        if (n + 1) * (m + 1) > maxTableCells {
            return oldLines.map { .removed($0) } + newLines.map { .added($0) }
        }
        // table[i][j] = LCS length of oldLines[i...] and newLines[j...]
        var table = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)
        for i in stride(from: n - 1, through: 0, by: -1) {
            for j in stride(from: m - 1, through: 0, by: -1) {
                table[i][j] = oldLines[i] == newLines[j]
                    ? table[i + 1][j + 1] + 1
                    : max(table[i + 1][j], table[i][j + 1])
            }
        }

        var entries: [LineDiffEntry] = []
        var i = 0
        var j = 0
        while i < n, j < m {
            if oldLines[i] == newLines[j] {
                entries.append(.unchanged(oldLines[i]))
                i += 1
                j += 1
            } else if table[i + 1][j] >= table[i][j + 1] {
                entries.append(.removed(oldLines[i]))
                i += 1
            } else {
                entries.append(.added(newLines[j]))
                j += 1
            }
        }
        while i < n { entries.append(.removed(oldLines[i])); i += 1 }
        while j < m { entries.append(.added(newLines[j])); j += 1 }
        return entries
    }
}
