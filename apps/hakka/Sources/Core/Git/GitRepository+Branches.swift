import Foundation

extension GitRepository {
    /// `nil` for a detached HEAD, where `--show-current` prints nothing.
    public func currentBranch() async throws -> String? {
        let result = try await runChecked(["branch", "--show-current"])
        let name = result.standardOutput.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? nil : name
    }

    /// Local branches only (`refs/heads/`), not remotes — the write surface
    /// this actor exposes is local branch management; a remote-tracking
    /// listing belongs to a read-side call this type does not need to make.
    public func listBranches() async throws -> [String] {
        let result = try await runChecked(["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
        return result.standardOutput
            .split(separator: "\n", omittingEmptySubsequences: true)
            .map(String.init)
    }

    /// `--` guards `name` from flag injection — a branch literally named
    /// `--upload-pack=evil` (the same shape as the real `git clone`
    /// argument-injection CVE class) is passed through as a literal ref
    /// name, never parsed as an option.
    public func createBranch(named name: String) async throws {
        try await runChecked(["branch", "--", name])
    }

    /// `git switch`, not `git checkout` — `checkout` is overloaded between
    /// "switch to this branch" and "restore these paths from this
    /// tree-ish", so a `--` placed before `branch` is ambiguous between the
    /// two readings and, depending on git's version, can land on the
    /// pathspec interpretation instead of the branch one. `switch` only
    /// ever takes a branch (plus `--` as a plain end-of-options marker), so
    /// the same guard here is unambiguous.
    public func checkout(branch: String) async throws {
        try await runChecked(["switch", "--", branch])
    }
}
