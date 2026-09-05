import Foundation

/// Git operations for a collection directory. Commands use argument arrays
/// through an injectable runner; callers must avoid overlapping writes while
/// an operation is suspended.
public actor GitRepository {
    public let directory: URL
    private let runner: any GitRunning

    public init(directory: URL, runner: any GitRunning = ProcessGitRunner()) {
        self.directory = directory
        self.runner = runner
    }

    /// Filesystem-only — no process spawned. `.git` is a directory for a
    /// normal repository and a file (`gitdir: <path>`) for a worktree or
    /// submodule checkout; either one's presence is enough to call
    /// `directory` a repository here. Static so a caller can check before
    /// deciding whether to construct a `GitRepository` at all, e.g. to
    /// choose between opening one and offering "Initialize Git".
    public static func isRepository(at directory: URL) -> Bool {
        FileManager.default.fileExists(atPath: directory.appendingPathComponent(".git").path)
    }

    /// `git init` against `directory` itself — `currentDirectoryURL` on the
    /// underlying `Process` is what scopes this, not a path argument, so
    /// there is nothing here for a `-`-prefixed string to inject into.
    public func initializeRepository() async throws {
        try await runChecked(["init"])
    }

    public func status() async throws -> GitStatus {
        let result = try await runChecked(["status", "--porcelain=v2", "--branch"])
        return GitStatusParser.parse(result.standardOutput)
    }

    /// `--` guards every element of `paths` from being read as a flag — a
    /// path a user (or an importer) named starting with `-` is passed
    /// through to git as a literal pathspec, never as an option.
    public func stage(paths: [String]) async throws {
        guard !paths.isEmpty else { return }
        try await runChecked(["add", "--"] + paths)
    }

    /// `restore --staged`, not `reset`, for the same reason `checkout` loses
    /// to `switch` for branches below: `reset` is overloaded (it also moves
    /// HEAD when given a commit-ish), where `restore --staged` only ever
    /// unstages paths, so there is no ambiguity for git to resolve `paths`
    /// against.
    ///
    /// `restore --staged` resets the index to HEAD, so on an unborn branch
    /// (a freshly-initialized repository, before its first commit) it fails
    /// outright with "fatal: could not resolve HEAD" — there is no HEAD to
    /// restore from. Every path staged in that state is necessarily a brand
    /// new file with nothing to restore *to*, so `rm --cached` (index-only,
    /// no HEAD lookup) is the correct unstage there instead.
    public func unstage(paths: [String]) async throws {
        guard !paths.isEmpty else { return }
        if await hasAnyCommits() {
            try await runChecked(["restore", "--staged", "--"] + paths)
        } else {
            try await runChecked(["rm", "--cached", "--"] + paths)
        }
    }

    private func hasAnyCommits() async -> Bool {
        let result = try? await runner.run(["rev-parse", "--verify", "-q", "HEAD"], in: directory)
        return result?.succeeded ?? false
    }

    /// The message never appears as a command-line argument — `-F <file>`
    /// takes it from a temp file this call writes and always removes, so a
    /// message starting with `-`, containing embedded quotes, or spanning
    /// multiple lines is inert: git reads it as file bytes, not argv.
    public func commit(message: String) async throws {
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("hakka-git-commit-\(UUID().uuidString).txt")
        try Data(message.utf8).write(to: tempURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: tempURL) }
        try await runChecked(["commit", "-F", tempURL.path])
    }

    /// Runs `arguments` and throws `GitError.commandFailed` (with git's own
    /// stderr) on a non-zero exit — the single choke point every other
    /// method in this file and its extensions goes through, so "git failed"
    /// is never silent.
    @discardableResult
    func runChecked(_ arguments: [String]) async throws -> GitProcessResult {
        let result = try await runner.run(arguments, in: directory)
        guard result.succeeded else {
            throw GitError.commandFailed(arguments: arguments, exitCode: result.exitCode, stderr: result.standardError)
        }
        return result
    }
}
