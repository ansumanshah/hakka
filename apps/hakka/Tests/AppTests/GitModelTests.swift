import Foundation
import HakkaCore
import Testing
@testable import HakkaApp

private actor FakeGitRunning: GitRunning {
    private(set) var invocations: [[String]] = []
    private var pauses: Set<String> = []
    private var pending: [String: CheckedContinuation<GitProcessResult, any Error>] = [:]
    private var waiters: [String: CheckedContinuation<Void, Never>] = [:]

    func pause(_ command: String, in directory: URL) {
        pauses.insert(directory.path + command)
    }

    func waitUntilPaused(_ command: String, in directory: URL) async {
        let key = directory.path + command
        if pending[key] != nil { return }
        await withCheckedContinuation { waiters[key] = $0 }
    }

    func resume(_ command: String, in directory: URL, error: GitError? = nil) {
        let key = directory.path + command
        let continuation = pending.removeValue(forKey: key)
        if let error {
            continuation?.resume(throwing: error)
        } else {
            continuation?.resume(returning: scripted[command] ?? GitProcessResult(exitCode: 0, standardOutput: "", standardError: ""))
        }
    }

    private var scripted: [String: GitProcessResult] = [:]

    func script(_ subcommand: String, _ result: GitProcessResult) {
        scripted[subcommand] = result
    }

    func run(_ arguments: [String], in directory: URL) async throws -> GitProcessResult {
        invocations.append(arguments)
        let key = directory.path + (arguments.first ?? "")
        if pauses.remove(key) != nil {
            return try await withCheckedThrowingContinuation {
                pending[key] = $0
                waiters.removeValue(forKey: key)?.resume()
            }
        }
        if let subcommand = arguments.first, let result = scripted[subcommand] {
            return result
        }
        return GitProcessResult(exitCode: 0, standardOutput: "", standardError: "")
    }
}

@Suite("GitModel")
@MainActor
struct GitModelTests {
    private func tempDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("git-model-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func repositoryDirectory() throws -> URL {
        let url = try tempDirectory()
        try FileManager.default.createDirectory(at: url.appendingPathComponent(".git"), withIntermediateDirectories: true)
        return url
    }

    private static let statusOutput = """
    # branch.head main
    1 M. N... 100644 100644 100644 0000000000000000000000000000000000000000 0000000000000000000000000000000000000000 staged.txt
    1 .M N... 100644 100644 100644 0000000000000000000000000000000000000000 0000000000000000000000000000000000000000 unstaged.txt
    ? untracked.txt
    """

    private func scriptCleanRefresh(_ fake: FakeGitRunning, branch: String = "main", branches: [String] = ["main"]) async {
        await fake.script("status", GitProcessResult(exitCode: 0, standardOutput: Self.statusOutput, standardError: ""))
        await fake.script("branch", GitProcessResult(exitCode: 0, standardOutput: "\(branch)\n", standardError: ""))
        await fake.script("for-each-ref", GitProcessResult(exitCode: 0, standardOutput: branches.joined(separator: "\n") + "\n", standardError: ""))
    }

    // MARK: - bind

    @Test func bindToNonRepositoryDirectoryLeavesEverythingEmptyAndRunsNoGitCommands() async throws {
        let fake = FakeGitRunning()
        let dir = try tempDirectory()
        let git = GitModel(runner: fake)

        await git.bind(to: dir)

        #expect(git.isRepository == false)
        #expect(git.status == nil)
        #expect(git.currentBranch == nil)
        #expect(git.branches.isEmpty)
        #expect(git.lastError == nil)
        let invocations = await fake.invocations
        #expect(invocations.isEmpty, "a directory with no .git must never shell out to git at all")
    }

    @Test func bindToRepositoryDirectoryRefreshesStatusBranchAndBranches() async throws {
        let fake = FakeGitRunning()
        await scriptCleanRefresh(fake, branch: "main", branches: ["main", "feature"])
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)

        await git.bind(to: dir)

        #expect(git.isRepository == true)
        #expect(git.currentBranch == "main")
        #expect(git.branches == ["main", "feature"])
        #expect(git.status?.staged.count == 1)
        #expect(git.status?.unstaged.count == 1)
        #expect(git.status?.untracked.count == 1)
        #expect(git.lastError == nil)
    }

    @Test func bindToNilDirectoryClearsEverythingAndCancelsInFlightWork() async throws {
        let fake = FakeGitRunning()
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        await git.bind(to: nil)

        #expect(git.directoryURL == nil)
        #expect(git.isRepository == false)
        #expect(git.status == nil)
        #expect(git.currentBranch == nil)
        #expect(git.branches.isEmpty)
    }

    // MARK: - initializeRepository

    @Test func initializeRepositoryTurnsANonRepoIntoARepoAndRefreshes() async throws {
        let fake = FakeGitRunning()
        await fake.script("init", GitProcessResult(exitCode: 0, standardOutput: "", standardError: ""))
        await scriptCleanRefresh(fake)
        let dir = try tempDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)
        #expect(git.isRepository == false)

        await git.initializeRepository()

        #expect(git.isRepository == true)
        #expect(git.currentBranch == "main")
        #expect(git.lastError == nil)
    }

    @Test func initializeRepositoryIsANoOpWhenAlreadyARepository() async throws {
        let fake = FakeGitRunning()
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        await git.initializeRepository()

        let invocations = await fake.invocations
        #expect(!invocations.contains { $0.first == "init" }, "re-initializing an existing repository must not re-run git init")
    }

    // MARK: - explicit action only

    @Test func bindingAndRefreshingNeverRunCommitPushPullOrInit() async throws {
        let fake = FakeGitRunning()
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)

        await git.bind(to: dir)
        await git.refresh()

        let subcommands = Set(await fake.invocations.compactMap(\.first))
        #expect(!subcommands.contains("commit"))
        #expect(!subcommands.contains("push"))
        #expect(!subcommands.contains("pull"))
        #expect(!subcommands.contains("init"))
    }

    // MARK: - stage / unstage

    @Test func stageCallsGitAddWithGivenPathsThenRefreshes() async throws {
        let fake = FakeGitRunning()
        await fake.script("add", GitProcessResult(exitCode: 0, standardOutput: "", standardError: ""))
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        await git.stage(["a.txt", "b.txt"])

        let addCall = await fake.invocations.first { $0.first == "add" }
        #expect(addCall == ["add", "--", "a.txt", "b.txt"])
        #expect(git.lastError == nil)
    }

    @Test func stageWithNoPathsRunsNoGitCommand() async throws {
        let fake = FakeGitRunning()
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)
        let before = await fake.invocations.count

        await git.stage([])

        let after = await fake.invocations.count
        #expect(before == after, "an empty stage call must not shell out to git at all")
    }

    // MARK: - commit

    @Test func commitWithBlankMessageRunsNoGitCommandAndReturnsFalse() async throws {
        let fake = FakeGitRunning()
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        let succeeded = await git.commit(message: "   ")

        #expect(succeeded == false)
        let invocations = await fake.invocations
        #expect(!invocations.contains { $0.first == "commit" }, "a blank message must be refused before git ever runs")
    }

    @Test func commitFailureSurfacesGitStderrAndReturnsFalse() async throws {
        let fake = FakeGitRunning()
        await fake.script("commit", GitProcessResult(exitCode: 1, standardOutput: "", standardError: "nothing to commit, working tree clean"))
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        let succeeded = await git.commit(message: "fix things")

        #expect(succeeded == false)
        #expect(git.lastError?.contains("nothing to commit") == true)
        #expect(git.isCommitting == false)
    }

    @Test func commitSuccessClearsErrorReturnsTrueAndRefreshes() async throws {
        let fake = FakeGitRunning()
        await fake.script("commit", GitProcessResult(exitCode: 0, standardOutput: "", standardError: ""))
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        let succeeded = await git.commit(message: "fix things")

        #expect(succeeded == true)
        #expect(git.lastError == nil)
        #expect(git.isCommitting == false)
    }

    // MARK: - branches

    @Test func checkoutSwitchesBranchAndRefreshesCurrentBranch() async throws {
        let fake = FakeGitRunning()
        await fake.script("switch", GitProcessResult(exitCode: 0, standardOutput: "", standardError: ""))
        await scriptCleanRefresh(fake, branch: "feature", branches: ["main", "feature"])
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        await git.checkout(branch: "feature")

        let switchCall = await fake.invocations.first { $0.first == "switch" }
        #expect(switchCall == ["switch", "--", "feature"])
        #expect(git.currentBranch == "feature")
    }

    @Test func createAndCheckoutStopsBeforeCheckoutWhenCreateFails() async throws {
        let fake = FakeGitRunning()
        await fake.script("branch", GitProcessResult(exitCode: 128, standardOutput: "", standardError: "fatal: a branch named 'feature' already exists"))
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        await git.createAndCheckout(branch: "feature")

        #expect(git.lastError?.contains("already exists") == true)
        let invocations = await fake.invocations
        #expect(!invocations.contains { $0.first == "switch" }, "a failed create must never be followed by a checkout")
    }

    // MARK: - pull / push

    @Test func pullFailureSurfacesErrorAndClearsInFlightState() async throws {
        let fake = FakeGitRunning()
        await fake.script("pull", GitProcessResult(exitCode: 1, standardOutput: "", standardError: "fatal: could not read from remote repository"))
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        git.pull()
        #expect(git.isPulling == true)
        await git.pullTask?.value

        #expect(git.isPulling == false)
        #expect(git.lastError?.contains("could not read from remote repository") == true)
    }

    @Test func pullSuccessClearsErrorAndRefreshes() async throws {
        let fake = FakeGitRunning()
        await fake.script("pull", GitProcessResult(exitCode: 0, standardOutput: "", standardError: ""))
        await scriptCleanRefresh(fake, branch: "main", branches: ["main"])
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        git.pull()
        await git.pullTask?.value

        #expect(git.isPulling == false)
        #expect(git.lastError == nil)
    }

    @Test func pushWhileAlreadyPushingDoesNotStartASecondPush() async throws {
        let fake = FakeGitRunning()
        await fake.script("push", GitProcessResult(exitCode: 0, standardOutput: "", standardError: ""))
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)

        // Both calls happen on this same MainActor turn, before either
        // task's body can run — `push()`'s own `pushTask == nil` guard is
        // what this test pins: the second call must see the first task's
        // reference already in place and do nothing.
        git.push()
        git.push()
        await git.pushTask?.value

        let pushCalls = await fake.invocations.filter { $0.first == "push" }
        #expect(pushCalls.count == 1, "a push already in flight must not be superseded by a second one")
    }

    // MARK: - diff

    @Test func diffForUntrackedEntryReadsRawFileContentsWithoutCallingGit() async throws {
        let fake = FakeGitRunning()
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        try "hello from disk".write(to: dir.appendingPathComponent("new.txt"), atomically: true, encoding: .utf8)
        let git = GitModel(runner: fake)
        await git.bind(to: dir)
        let entry = GitStatusEntry(path: "new.txt", indexStatus: "?", worktreeStatus: "?")
        let before = await fake.invocations.count

        let text = await git.diff(for: GitDiffSelection(entry: entry, fromStagedSection: false))

        #expect(text == "hello from disk")
        let after = await fake.invocations.count
        #expect(before == after, "an untracked file's preview must never shell out to git")
    }

    @Test func diffForStagedEntryCallsGitDiffStagedWithThePath() async throws {
        let fake = FakeGitRunning()
        await fake.script("diff", GitProcessResult(exitCode: 0, standardOutput: "+added line", standardError: ""))
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)
        let entry = GitStatusEntry(path: "staged.txt", indexStatus: "M", worktreeStatus: ".")

        let text = await git.diff(for: GitDiffSelection(entry: entry, fromStagedSection: true))

        #expect(text == "+added line")
        let diffCall = await fake.invocations.first { $0.first == "diff" }
        #expect(diffCall == ["diff", "--staged", "--", "staged.txt"])
    }

    @Test func aFileStagedAndThenEditedAgainDiffsPerSectionNotPerEntry() async throws {
        let fake = FakeGitRunning()
        await fake.script("diff", GitProcessResult(exitCode: 0, standardOutput: "+x", standardError: ""))
        await scriptCleanRefresh(fake)
        let dir = try repositoryDirectory()
        let git = GitModel(runner: fake)
        await git.bind(to: dir)
        // "MM": modified in the index AND modified again in the working tree,
        // so both predicates are true for this one entry.
        let entry = GitStatusEntry(path: "both.txt", indexStatus: "M", worktreeStatus: "M")
        #expect(entry.isStaged, "fixture must be staged for this test to mean anything")
        #expect(entry.isUnstaged, "fixture must also be unstaged for this test to mean anything")

        _ = await git.diff(for: GitDiffSelection(entry: entry, fromStagedSection: false))
        let unstagedCall = await fake.invocations.last { $0.first == "diff" }
        #expect(unstagedCall == ["diff", "--", "both.txt"], "the Unstaged section must ask for the working-tree diff")

        _ = await git.diff(for: GitDiffSelection(entry: entry, fromStagedSection: true))
        let stagedCall = await fake.invocations.last { $0.first == "diff" }
        #expect(stagedCall == ["diff", "--staged", "--", "both.txt"], "the Staged section must ask for the index diff")
    }
    @Test(arguments: ["add", "restore"])
    func stagingFailureRemainsVisible(command: String) async throws {
        let fake = FakeGitRunning()
        await scriptCleanRefresh(fake)
        await fake.script(command, GitProcessResult(exitCode: 1, standardOutput: "", standardError: "index is locked"))
        let directory = try repositoryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let git = GitModel(runner: fake)
        await git.bind(to: directory)

        if command == "add" { await git.stage(["file.txt"]) }
        else { await git.unstage(["file.txt"]) }

        #expect(git.lastError?.contains("index is locked") == true)
    }

    @Test func oldRefreshCannotReplaceTheNewCollectionState() async throws {
        let fake = FakeGitRunning()
        let old = try repositoryDirectory()
        let new = try repositoryDirectory()
        defer {
            try? FileManager.default.removeItem(at: old)
            try? FileManager.default.removeItem(at: new)
        }
        await scriptCleanRefresh(fake, branch: "new")
        await fake.pause("status", in: old)
        let git = GitModel(runner: fake)
        let binding = Task { await git.bind(to: old) }
        await fake.waitUntilPaused("status", in: old)
        await git.bind(to: new)
        await scriptCleanRefresh(fake, branch: "old")
        await fake.resume("status", in: old)
        await binding.value

        #expect(git.directoryURL == new)
        #expect(git.currentBranch == "new")
        #expect(!git.isRefreshing)
        #expect(git.lastError == nil)
    }

    @Test(arguments: ["pull", "push"])
    func oldRemoteCompletionCannotClearTheNewRemoteTask(command: String) async throws {
        let fake = FakeGitRunning()
        await scriptCleanRefresh(fake)
        let old = try repositoryDirectory()
        let new = try repositoryDirectory()
        defer {
            try? FileManager.default.removeItem(at: old)
            try? FileManager.default.removeItem(at: new)
        }
        let git = GitModel(runner: fake)
        await git.bind(to: old)
        await fake.pause(command, in: old)
        if command == "pull" { git.pull() } else { git.push() }
        let oldTask = command == "pull" ? git.pullTask : git.pushTask
        await fake.waitUntilPaused(command, in: old)
        await git.bind(to: new)
        await fake.pause(command, in: new)
        if command == "pull" { git.pull() } else { git.push() }
        let newTask = command == "pull" ? git.pullTask : git.pushTask
        await fake.waitUntilPaused(command, in: new)
        await fake.resume(command, in: old, error: .commandFailed(arguments: [command], exitCode: 1, stderr: "old remote failed"))
        await oldTask?.value

        #expect(command == "pull" ? git.isPulling : git.isPushing)
        #expect(git.lastError == nil)
        await fake.resume(command, in: new)
        await newTask?.value
        #expect(!(command == "pull" ? git.isPulling : git.isPushing))
    }

    @Test(arguments: ["pull", "push"])
    func gitCancellationDoesNotSurfaceAsFailure(command: String) async throws {
        let fake = FakeGitRunning()
        await scriptCleanRefresh(fake)
        let directory = try repositoryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let git = GitModel(runner: fake)
        await git.bind(to: directory)
        await fake.pause(command, in: directory)
        if command == "pull" { git.pull() } else { git.push() }
        let task = command == "pull" ? git.pullTask : git.pushTask
        await fake.waitUntilPaused(command, in: directory)
        await fake.resume(command, in: directory, error: .cancelled)
        await task?.value

        #expect(git.lastError == nil)
        #expect(!(command == "pull" ? git.isPulling : git.isPushing))
    }

}
