import Foundation
import Testing
@testable import HakkaCore

/// Runs `GitRepository` against a real `/usr/bin/git`, on a real temp
/// repository, for every capability the write track promises: init, status,
/// stage/unstage, commit, branch create/checkout, diff. A fake runner can
/// prove `GitRepository` builds the arguments it intends to; only a real
/// process proves git actually does what those arguments claim.
///
/// `.enabled(if:)` reports the whole suite skipped, not failed, on a machine
/// without git — `GitTestEnvironment.gitIsAvailable`.
@Suite("GitRepository (real git)", .serialized, .enabled(if: GitTestEnvironment.gitIsAvailable))
struct GitRepositoryIntegrationTests {
    @Test func initializeRepositoryCreatesADotGitDirectoryGitRecognizesAsARepo() async throws {
        try await GitTestRepository.withFreshRepository { _, directory in
            #expect(GitRepository.isRepository(at: directory))
        }
    }

    @Test func isRepositoryIsFalseForAPlainDirectoryThatWasNeverInitialized() {
        let directory = GitTestRepository.makeDirectory(prefix: "hakka-git-not-a-repo")
        #expect(!GitRepository.isRepository(at: directory))
    }

    @Test func statusOnAFreshRepoWithOneNewFileReportsItUntracked() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("hello", to: "a.txt", in: directory)
            let status = try await repository.status()
            #expect(status.untracked.map(\.path) == ["a.txt"])
            #expect(status.staged.isEmpty)
            #expect(status.unstaged.isEmpty)
        }
    }

    @Test func stagingMovesAFileFromUntrackedToStaged() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("hello", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])
            let status = try await repository.status()
            #expect(status.staged.map(\.path) == ["a.txt"])
            #expect(status.untracked.isEmpty)
        }
    }

    @Test func unstageMovesAStagedFileBackToUntracked() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("hello", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])
            try await repository.unstage(paths: ["a.txt"])
            let status = try await repository.status()
            #expect(status.untracked.map(\.path) == ["a.txt"])
            #expect(status.staged.isEmpty)
        }
    }

    @Test func committingStagedChangesLeavesTheRepositoryClean() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("hello", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])
            try await repository.commit(message: "add a.txt")
            let status = try await repository.status()
            #expect(status.isClean)
        }
    }

    @Test func committingWithNothingStagedFailsWithCommandFailed() async throws {
        try await GitTestRepository.withFreshRepository { repository, _ in
            do {
                try await repository.commit(message: "nothing to see here")
                Issue.record("expected an empty commit to fail")
            } catch let GitError.commandFailed(_, exitCode, _) {
                #expect(exitCode != 0)
            }
        }
    }

    @Test func currentBranchReportsTheInitialBranchAfterTheFirstCommit() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("hello", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])
            try await repository.commit(message: "initial")
            let branch = try #require(await repository.currentBranch())
            #expect(!branch.isEmpty)
        }
    }

    @Test func createBranchThenCheckoutSwitchesTheCurrentBranch() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("hello", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])
            try await repository.commit(message: "initial")

            try await repository.createBranch(named: "feature-x")
            let branches = try await repository.listBranches()
            #expect(branches.contains("feature-x"))

            try await repository.checkout(branch: "feature-x")
            let current = try await repository.currentBranch()
            #expect(current == "feature-x")
        }
    }

    @Test func diffShowsAnUnstagedEditAndStagedDiffShowsItOnceStaged() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("line one\n", to: "a.txt", in: directory)
            try await repository.stage(paths: ["a.txt"])
            try await repository.commit(message: "initial")

            try GitTestRepository.write("line one\nline two\n", to: "a.txt", in: directory)
            let unstaged = try await repository.diff()
            #expect(unstaged.contains("line two"))

            let stagedBeforeAdd = try await repository.stagedDiff()
            #expect(stagedBeforeAdd.isEmpty)

            try await repository.stage(paths: ["a.txt"])
            let staged = try await repository.stagedDiff()
            #expect(staged.contains("line two"))
        }
    }

    @Test func diffScopedToAPathIgnoresChangesInOtherFiles() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("a\n", to: "a.txt", in: directory)
            try GitTestRepository.write("b\n", to: "b.txt", in: directory)
            try await repository.stage(paths: ["a.txt", "b.txt"])
            try await repository.commit(message: "initial")

            try GitTestRepository.write("a\nchanged\n", to: "a.txt", in: directory)
            try GitTestRepository.write("b\nchanged\n", to: "b.txt", in: directory)

            let scoped = try await repository.diff(path: "a.txt")
            #expect(scoped.contains("a.txt"))
            #expect(!scoped.contains("b.txt"))
        }
    }
}
