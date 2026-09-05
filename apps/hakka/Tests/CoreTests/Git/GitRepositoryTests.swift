import Foundation
import Testing
@testable import HakkaCore

/// Exercises `GitRepository` against `FakeGitRunner` — verifying the exact
/// argument array each method builds (the `--` injection guard, `-F` for
/// commit messages, `switch` over `checkout`) and how a non-zero exit or a
/// runner-level throw surfaces as a typed `GitError`. `GitRepositoryIntegrationTests`
/// and `GitInjectionSafetyTests` cover the same contract against real git.
@Suite("GitRepository (fake runner)")
struct GitRepositoryTests {
    private func directory() -> URL {
        GitTestRepository.makeDirectory(prefix: "hakka-git-fake")
    }

    @Test func stageGuardsEveryPathWithADashDashSeparator() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        try await repository.stage(paths: ["-rf", "normal.txt"])
        let invocations = await runner.invocations
        #expect(invocations.map(\.arguments) == [["add", "--", "-rf", "normal.txt"]])
    }

    @Test func stagingAnEmptyPathListMakesNoGitCallAtAll() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        try await repository.stage(paths: [])
        #expect(await runner.invocations.isEmpty)
    }

    /// `unstage` checks for an existing commit (`rev-parse --verify -q HEAD`)
    /// before deciding how to unstage — see `GitRepository.unstage`'s own
    /// comment for why an unborn branch needs `rm --cached` instead of
    /// `restore --staged`. `FakeGitRunner`'s default result is a successful
    /// exit, so that check reads as "commits exist" here, and `restore
    /// --staged` is the call that follows it.
    @Test func unstageUsesRestoreStagedAndGuardsPathsTheSameWay() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        try await repository.unstage(paths: ["-x"])
        let invocations = await runner.invocations
        #expect(invocations.map(\.arguments) == [
            ["rev-parse", "--verify", "-q", "HEAD"],
            ["restore", "--staged", "--", "-x"],
        ])
    }

    /// The unborn-branch path: when `rev-parse --verify HEAD` itself fails
    /// (no commits yet), `unstage` falls back to `rm --cached` instead of
    /// `restore --staged`, which would fail with "could not resolve HEAD".
    @Test func unstageFallsBackToRmCachedWhenThereIsNoCommitYet() async throws {
        let runner = FakeGitRunner(results: [
            GitProcessResult(exitCode: 1, standardOutput: "", standardError: "fatal: needed a single revision"),
        ])
        let repository = GitRepository(directory: directory(), runner: runner)
        try await repository.unstage(paths: ["-x"])
        let invocations = await runner.invocations
        #expect(invocations.map(\.arguments) == [
            ["rev-parse", "--verify", "-q", "HEAD"],
            ["rm", "--cached", "--", "-x"],
        ])
    }

    @Test func commitPassesTheMessageThroughAFileNeverAsABareArgument() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        try await repository.commit(message: "-not-a-flag\nwith \"quotes\" and a trailing newline\n")
        let invocations = await runner.invocations
        #expect(invocations.count == 1)
        let arguments = invocations[0].arguments
        #expect(arguments.first == "commit")
        #expect(arguments.contains("-F"))
        // The message text itself must never appear as an argument — only
        // the path to the temp file it was written to.
        #expect(!arguments.contains { $0.contains("not-a-flag") })
    }

    @Test func createBranchGuardsTheNameWithADashDashSeparator() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        try await repository.createBranch(named: "--upload-pack=evil")
        let invocations = await runner.invocations
        #expect(invocations.map(\.arguments) == [["branch", "--", "--upload-pack=evil"]])
    }

    @Test func checkoutUsesSwitchRatherThanCheckoutAndGuardsTheBranchName() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        try await repository.checkout(branch: "--upload-pack=evil")
        let invocations = await runner.invocations
        #expect(invocations.map(\.arguments) == [["switch", "--", "--upload-pack=evil"]])
    }

    /// `--` alone is not trusted for `pull`/`push`: a flag-shaped `remote`
    /// or `branch` is rejected with `.unsafeArgument` before this call ever
    /// reaches the runner — see `GitRepository+Remote.swift`'s
    /// `requireNotFlagLike` for the `GIT_TRACE` finding that makes this
    /// necessary (`git pull` relays its repository argument to an internal
    /// `git fetch` call without re-guarding it).
    @Test func pullRejectsAFlagShapedRemoteBeforeEverCallingGit() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        do {
            try await repository.pull(remote: "--upload-pack=evil")
            Issue.record("expected GitError.unsafeArgument")
        } catch let GitError.unsafeArgument(field, value) {
            #expect(field == "remote")
            #expect(value == "--upload-pack=evil")
        }
        #expect(await runner.invocations.isEmpty)
    }

    @Test func pullRejectsAFlagShapedBranchBeforeEverCallingGit() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        do {
            try await repository.pull(remote: "origin", branch: "-x")
            Issue.record("expected GitError.unsafeArgument")
        } catch let GitError.unsafeArgument(field, value) {
            #expect(field == "branch")
            #expect(value == "-x")
        }
        #expect(await runner.invocations.isEmpty)
    }

    @Test func pushRejectsAFlagShapedRemoteBeforeEverCallingGit() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        do {
            try await repository.push(remote: "--upload-pack=evil")
            Issue.record("expected GitError.unsafeArgument")
        } catch let GitError.unsafeArgument(field, value) {
            #expect(field == "remote")
            #expect(value == "--upload-pack=evil")
        }
        #expect(await runner.invocations.isEmpty)
    }

    @Test func pullAndPushGuardOrdinaryRemoteAndBranchWithDashDashAsUsual() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        try await repository.pull(remote: "origin", branch: "main")
        try await repository.push(remote: "origin", branch: "main")
        let invocations = await runner.invocations
        #expect(invocations.map(\.arguments) == [
            ["pull", "--", "origin", "main"],
            ["push", "--", "origin", "main"],
        ])
    }

    @Test func pullWithNoBranchOmitsTheBranchArgumentEntirely() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        try await repository.pull(remote: "origin")
        let invocations = await runner.invocations
        #expect(invocations.map(\.arguments) == [["pull", "--", "origin"]])
    }

    @Test func diffGuardsThePathAndOnlyAddsStagedWhenRequested() async throws {
        let runner = FakeGitRunner()
        let repository = GitRepository(directory: directory(), runner: runner)
        _ = try await repository.diff(path: "-x")
        _ = try await repository.stagedDiff(path: "-y")
        _ = try await repository.diff()
        let invocations = await runner.invocations
        #expect(invocations.map(\.arguments) == [
            ["diff", "--", "-x"],
            ["diff", "--staged", "--", "-y"],
            ["diff", "--"],
        ])
    }

    @Test func aNonZeroExitBecomesCommandFailedCarryingGitsOwnStderr() async throws {
        let runner = FakeGitRunner(results: [
            GitProcessResult(exitCode: 1, standardOutput: "", standardError: "fatal: nope"),
        ])
        let repository = GitRepository(directory: directory(), runner: runner)
        do {
            try await repository.stage(paths: ["a"])
            Issue.record("expected GitError.commandFailed")
        } catch let GitError.commandFailed(arguments, exitCode, stderr) {
            #expect(arguments == ["add", "--", "a"])
            #expect(exitCode == 1)
            #expect(stderr == "fatal: nope")
        }
    }

    @Test func aMissingGitExecutablePropagatesAsGitNotFound() async throws {
        let runner = FakeGitRunner(errorToThrow: GitError.gitNotFound)
        let repository = GitRepository(directory: directory(), runner: runner)
        do {
            _ = try await repository.status()
            Issue.record("expected GitError.gitNotFound")
        } catch GitError.gitNotFound {
            // expected
        }
    }

    @Test func statusParsesTheRunnersOutputThroughGitStatusParser() async throws {
        let runner = FakeGitRunner(results: [
            GitProcessResult(exitCode: 0, standardOutput: "# branch.head main\0? new.txt", standardError: ""),
        ])
        let repository = GitRepository(directory: directory(), runner: runner)
        let status = try await repository.status()
        #expect(status.branch == "main")
        #expect(status.untracked.map(\.path) == ["new.txt"])
    }
}
