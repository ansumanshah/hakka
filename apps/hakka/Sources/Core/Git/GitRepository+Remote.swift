import Foundation

extension GitRepository {
    /// `remote` and `branch` are rejected up front, before git ever runs,
    /// if either starts with `-` — see `requireNotFlagLike` below for why
    /// this call's own `--` is not sufficient protection here the way it is
    /// for every other method in this actor.
    ///
    /// Cancellable and off the main actor: this actor's isolation already
    /// keeps it off `@MainActor`, and `ProcessGitRunner` responds to the
    /// calling `Task`'s cancellation by sending the underlying process
    /// `SIGTERM`, so a user cancelling a slow pull actually stops the
    /// network operation instead of only abandoning the awaiting call.
    public func pull(remote: String, branch: String? = nil) async throws {
        try Self.requireNotFlagLike(remote, field: "remote")
        if let branch { try Self.requireNotFlagLike(branch, field: "branch") }
        var arguments = ["pull", "--", remote]
        if let branch { arguments.append(branch) }
        try await runChecked(arguments)
    }

    /// Same guarding and cancellation behavior as `pull`, for `git push`.
    public func push(remote: String, branch: String? = nil) async throws {
        try Self.requireNotFlagLike(remote, field: "remote")
        if let branch { try Self.requireNotFlagLike(branch, field: "branch") }
        var arguments = ["push", "--", remote]
        if let branch { arguments.append(branch) }
        try await runChecked(arguments)
    }

    /// `--` in this actor's own argv guards against *this* invocation's
    /// option parser reading `value` as a flag — but `git pull` was proven
    /// (via `GIT_TRACE=1`, by hand) to internally re-invoke `git fetch`
    /// with the repository argument copied onto a *new*, unguarded argv:
    ///
    /// ```
    /// run_command: git fetch --update-head-ok --upload-pack=evil main
    /// run_command: unset GIT_PREFIX; GIT_PROTOCOL=version=2 'evil '\''main'\'''
    /// start_command: /bin/sh -c 'evil '\''main'\''' 'evil '\''main'\'''
    /// ```
    ///
    /// `pull`'s own `--` never reaches that inner `fetch` call, which then
    /// reads `--upload-pack=evil` as a real option and hands the program
    /// name `evil` straight to `/bin/sh -c` — this codebase's `--upload-pack=evil`
    /// stand-in for the real payload (`--upload-pack=touch$IFS/tmp/pwned`,
    /// the shape of the actual, historical git argument-injection class)
    /// would have executed. Rejecting anything flag-shaped before it ever
    /// reaches git closes that gap regardless of which internal git command
    /// ends up relaying it, rather than trusting every porcelain command's
    /// internals to keep re-applying `--` the way this file does.
    private static func requireNotFlagLike(_ value: String, field: String) throws {
        guard value.hasPrefix("-") else { return }
        throw GitError.unsafeArgument(field: field, value: value)
    }
}
