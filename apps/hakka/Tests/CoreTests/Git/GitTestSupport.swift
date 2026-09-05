import Foundation
@testable import HakkaCore

/// Shared by every Git test file in this directory — none of them are
/// `@Test` suites themselves.
enum GitTestEnvironment {
    /// Every `@Suite` that spawns a real `git` process gates on this via
    /// `.enabled(if:)`, so the suite is reported skipped (not failed) on a
    /// machine or CI image without the Xcode Command Line Tools installed.
    static var gitIsAvailable: Bool {
        FileManager.default.isExecutableFile(atPath: "/usr/bin/git")
    }
}

/// A `GitRunning` double that records every invocation it receives and
/// replays pre-scripted results in order. Lets `GitRepositoryTests` assert
/// on the exact argument array `GitRepository` builds for each call — the
/// injection-guard contract — without spawning a real process, and lets it
/// force error paths (a non-zero exit, `.gitNotFound`) that are awkward to
/// coax out of a real repository on demand.
actor FakeGitRunner: GitRunning {
    struct Invocation: Sendable, Equatable {
        let arguments: [String]
        let directory: URL
    }

    private(set) var invocations: [Invocation] = []
    private var results: [GitProcessResult]
    private let errorToThrow: (any Error)?

    init(results: [GitProcessResult] = [], errorToThrow: (any Error)? = nil) {
        self.results = results
        self.errorToThrow = errorToThrow
    }

    func run(_ arguments: [String], in directory: URL) async throws -> GitProcessResult {
        invocations.append(Invocation(arguments: arguments, directory: directory))
        if let errorToThrow { throw errorToThrow }
        guard !results.isEmpty else {
            return GitProcessResult(exitCode: 0, standardOutput: "", standardError: "")
        }
        return results.removeFirst()
    }
}

/// Test helpers shared by both the integration and injection-safety suites:
/// stand up a real, throwaway repository on disk, always removed afterward.
enum GitTestRepository {
    /// A fresh temp directory per call — never reused across tests, so
    /// nothing here needs its own cleanup ordering.
    static func makeDirectory(prefix: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
    }

    /// Creates `directory`, runs `git init` through a real `GitRepository`,
    /// sets a local (not global) commit identity so a commit never depends
    /// on — or pollutes — whatever `user.name`/`user.email` happen to be
    /// configured on the machine running the test, hands the repository to
    /// `body`, then removes `directory` whether `body` throws or not.
    static func withFreshRepository(
        prefix: String = "hakka-git-test",
        _ body: (GitRepository, URL) async throws -> Void,
    ) async throws {
        let directory = makeDirectory(prefix: prefix)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let repository = GitRepository(directory: directory)
        try await repository.initializeRepository()
        let runner = ProcessGitRunner()
        _ = try await runner.run(["config", "user.name", "Hakka Test"], in: directory)
        _ = try await runner.run(["config", "user.email", "test@hakka.local"], in: directory)

        try await body(repository, directory)
    }

    @discardableResult
    static func write(_ contents: String, to fileName: String, in directory: URL) throws -> URL {
        let url = directory.appendingPathComponent(fileName)
        try Data(contents.utf8).write(to: url, options: .atomic)
        return url
    }
}
