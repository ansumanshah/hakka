import Foundation

extension GitRepository {
    /// Unstaged diff (worktree vs. index). `path == nil` diffs the whole
    /// tree.
    public func diff(path: String? = nil) async throws -> String {
        try await runDiff(staged: false, path: path)
    }

    /// Staged diff (index vs. HEAD) — what `commit` would record right now.
    public func stagedDiff(path: String? = nil) async throws -> String {
        try await runDiff(staged: true, path: path)
    }

    /// `--` guards `path` the same way every other user-text site in this
    /// actor does; it comes before `path` regardless of whether one was
    /// given, so a whole-tree diff (`path == nil`) still gets the same
    /// argument shape as a scoped one.
    private func runDiff(staged: Bool, path: String?) async throws -> String {
        var arguments = ["diff"]
        if staged { arguments.append("--staged") }
        arguments.append("--")
        if let path { arguments.append(path) }
        let result = try await runChecked(arguments)
        return result.standardOutput
    }
}
