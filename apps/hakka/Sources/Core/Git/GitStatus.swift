import Foundation

/// One line of `git status --porcelain=v2 --branch` output, typed.
///
/// `indexStatus`/`worktreeStatus` are the raw `XY` pair from git's own
/// format — `.` means "no change in that half". Untracked and ignored
/// entries have no `XY` at all in porcelain v2 (they're `? path` / `! path`
/// records), so both fields are set to `?`/`!` respectively for them, which
/// is also what `isUntracked`/`isIgnored` key off.
public struct GitStatusEntry: Sendable, Equatable {
    public let path: String
    /// Set only for a rename/copy record — the path this entry moved from.
    public let originalPath: String?
    public let indexStatus: Character
    public let worktreeStatus: Character

    public init(path: String, originalPath: String? = nil, indexStatus: Character, worktreeStatus: Character) {
        self.path = path
        self.originalPath = originalPath
        self.indexStatus = indexStatus
        self.worktreeStatus = worktreeStatus
    }

    public var isUntracked: Bool { indexStatus == "?" }
    public var isIgnored: Bool { indexStatus == "!" }
    /// Both halves must actually change; `1 .M` (index clean) is not staged.
    public var isStaged: Bool { indexStatus != "." && indexStatus != "?" && indexStatus != "!" }
    public var isUnstaged: Bool { worktreeStatus != "." && worktreeStatus != "?" && worktreeStatus != "!" }
}

/// The parsed result of one `git status` call: the current branch (`nil`
/// when HEAD is detached) plus every changed/untracked/ignored path,
/// bucketed for the three views a UI actually needs — staged for the
/// commit, unstaged as the diff against the index, and untracked as "not
/// yet part of this repository at all".
public struct GitStatus: Sendable, Equatable {
    public let branch: String?
    public let entries: [GitStatusEntry]

    public init(branch: String?, entries: [GitStatusEntry]) {
        self.branch = branch
        self.entries = entries
    }

    public var staged: [GitStatusEntry] { entries.filter(\.isStaged) }
    public var unstaged: [GitStatusEntry] { entries.filter(\.isUnstaged) }
    public var untracked: [GitStatusEntry] { entries.filter(\.isUntracked) }
    public var isClean: Bool { entries.allSatisfy(\.isIgnored) }
}
