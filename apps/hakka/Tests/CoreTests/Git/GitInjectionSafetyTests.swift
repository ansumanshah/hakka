import Foundation
import Testing
@testable import HakkaCore

/// One focused test per injection vector named in the write track's brief,
/// each run against real `/usr/bin/git` — a fake runner can only prove
/// `GitRepository` builds the argument array it intends to; only a real
/// process proves that array actually defeats the attack.
///
/// The shared shape being probed is `--upload-pack=evil` and its relatives:
/// the real `git clone`/`push`/`pull` argument-injection class where a
/// string that looks like a repository, branch, or path name is actually a
/// flag telling git to run an arbitrary program. Every vector here is a
/// verified-by-hand round trip (see the comment on each test for the exact
/// git diagnostic that proves the guard did something, not just that it
/// compiled) — not a guess at what git does.
///
/// That verification is what caught a real gap during this track's own
/// development: `--` alone looked sufficient for `pull` until
/// `GIT_TRACE=1` showed `git pull` relaying its repository argument to an
/// internal `git fetch` call *without* re-guarding it, turning
/// `--upload-pack=evil` into a real `/bin/sh -c` invocation. See
/// `GitRepository+Remote.swift`'s `requireNotFlagLike` for the fix.
@Suite("GitRepository injection safety", .enabled(if: GitTestEnvironment.gitIsAvailable))
struct GitInjectionSafetyTests {
    /// `git add`/`restore` accept the guarded string as a literal pathspec
    /// and succeed outright — this is the vector where "safe" looks like
    /// an ordinary successful call, not an error. Verified by hand: the
    /// same call *without* `--` fails with `error: unknown switch `l''`
    /// (git reads `-evil.txt` as a bundle of single-letter flags), so the
    /// success here is `--` doing real work, not git being lenient anyway.
    @Test func pathStartingWithADashIsStagedAsALiteralFileNeverReadAsFlags() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            let fileName = "-evil.txt"
            try GitTestRepository.write("content", to: fileName, in: directory)

            try await repository.stage(paths: [fileName])
            let status = try await repository.status()
            #expect(status.staged.map(\.path) == [fileName])
        }
    }

    /// Symmetric case for `unstage` (`git restore --staged --`).
    @Test func pathStartingWithADashCanBeUnstagedAsALiteralFile() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            let fileName = "-evil.txt"
            try GitTestRepository.write("content", to: fileName, in: directory)
            try await repository.stage(paths: [fileName])

            try await repository.unstage(paths: [fileName])
            let status = try await repository.status()
            #expect(status.untracked.map(\.path) == [fileName])
        }
    }

    /// The message never becomes a command-line argument at all (`-F
    /// <tempfile>`), so a message that starts with `-` can't be read as a
    /// flag by construction — proven here by reading it back with `git log`
    /// and getting the exact text, including the leading dash, rather than
    /// an error or a silently-dropped commit.
    @Test func commitMessageStartingWithADashIsRecordedVerbatimNeverReadAsAFlag() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("content", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])

            let message = "--amend and other lies"
            try await repository.commit(message: message)

            let recorded = try await lastCommitMessage(in: directory)
            #expect(recorded == message)
        }
    }

    /// Newlines and embedded quotes are exactly what `-m "<text>"` handles
    /// badly (a shell-quoting nightmare, and multi-line `-m` needs its own
    /// escaping); `-F` sidesteps all of it because the file's bytes are the
    /// message; a `$(...)`-shaped substring is included to confirm this
    /// path never goes anywhere near a shell that would expand it.
    @Test func commitMessageWithNewlinesAndQuotesRoundTripsExactly() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("content", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])

            let message = "Subject line\n\nBody with \"quotes\", 'apostrophes', and a $(rm -rf /) look-alike."
            try await repository.commit(message: message)

            let recorded = try await lastCommitMessage(in: directory)
            #expect(recorded == message)
        }
    }

    /// `git branch`/`git switch` reject any ref name starting with `-`
    /// outright (git's own `check-ref-format` defense, independent of this
    /// code) — so this vector can never succeed as a literal branch name on
    /// a modern git, and the correct behavior is a *different* failure than
    /// the unguarded one. Verified by hand: with `--`, git fails with
    /// `fatal: '--upload-pack=evil' is not a valid branch name` (exit 128 —
    /// git validated it as a would-be ref and rejected it); without `--`,
    /// the same string fails with `error: unknown option `upload-pack=evil''`
    /// (exit 129 — git's option parser consumed it). This test proves
    /// `createBranch` produces the first diagnostic, never the second —
    /// i.e. the string reached git as the positional branch-name argument,
    /// not as something git's flag parser got to interpret.
    @Test func branchNamedLikeAGitFlagIsRejectedAsAnInvalidRefNameNotAnUnknownOption() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("hello", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])
            try await repository.commit(message: "initial")

            do {
                try await repository.createBranch(named: "--upload-pack=evil")
                Issue.record("git rejects any ref name starting with '-'; this should have thrown")
            } catch let GitError.commandFailed(_, exitCode, stderr) {
                #expect(exitCode == 128)
                #expect(stderr.contains("--upload-pack=evil"))
                #expect(!stderr.contains("unknown option"))
            }

            let branches = try await repository.listBranches()
            #expect(!branches.contains("--upload-pack=evil"))
        }
    }

    /// This is the vector that turned out to matter most in this whole
    /// track: `--` guarding `pull`'s own argv is **not** sufficient, proven
    /// by hand with `GIT_TRACE=1 git pull -- --upload-pack=evil main` —
    /// `git pull` internally re-invokes `git fetch` and copies the
    /// repository argument onto a *new*, unguarded argv:
    ///
    /// ```
    /// run_command: git fetch --update-head-ok --upload-pack=evil main
    /// start_command: /bin/sh -c 'evil '\''main'\''' 'evil '\''main'\'''
    /// ```
    ///
    /// i.e. `git fetch` reads `--upload-pack=evil` as a real option and
    /// hands the literal program name `evil` to `/bin/sh -c` — with a real
    /// payload (`--upload-pack=touch$IFS/tmp/pwned`) this is arbitrary
    /// command execution, not a parse error. `GitRepository.pull` closes
    /// this by rejecting any flag-shaped `remote`/`branch` itself, before
    /// git ever runs — this test proves that rejection fires, never a
    /// `commandFailed` from git having actually run.
    @Test func pullFromARemoteNamedLikeAFlagIsRejectedBeforeGitEverRunsNotAfter() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("hello", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])
            try await repository.commit(message: "initial")

            do {
                try await repository.pull(remote: "--upload-pack=evil", branch: "main")
                Issue.record("expected GitError.unsafeArgument")
            } catch let GitError.unsafeArgument(field, value) {
                #expect(field == "remote")
                #expect(value == "--upload-pack=evil")
            }
        }
    }

    /// Same rejection for `push`, applied symmetrically even though `push`
    /// alone (verified by hand: `fatal: strange pathname '--upload-pack=evil'
    /// blocked`) did not reproduce the same relay as `pull` — this codebase
    /// does not lean on that difference holding across git versions.
    @Test func pushToARemoteNamedLikeAFlagIsRejectedBeforeGitEverRunsNotAfter() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("hello", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])
            try await repository.commit(message: "initial")

            do {
                try await repository.push(remote: "--upload-pack=evil", branch: "main")
                Issue.record("expected GitError.unsafeArgument")
            } catch let GitError.unsafeArgument(field, value) {
                #expect(field == "remote")
                #expect(value == "--upload-pack=evil")
            }
        }
    }

    private func lastCommitMessage(in directory: URL) async throws -> String {
        let runner = ProcessGitRunner()
        let result = try await runner.run(["log", "-1", "--format=%B"], in: directory)
        // Two trailing newlines to strip, not one: git normalizes every
        // commit message to end with exactly one newline when it stores
        // it, and `git log`'s own pretty-printer appends a further newline
        // after each formatted entry. Neither is part of the message text
        // this test wrote, so both come off.
        var text = result.standardOutput
        while text.hasSuffix("\n") { text.removeLast() }
        return text
    }
}
