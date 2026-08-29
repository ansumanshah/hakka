import Foundation

/// The raw result of one `git` invocation, before `GitRepository` decides
/// whether a non-zero exit is an error worth throwing (some callers — e.g. a
/// future "is this a repository" probe — want to inspect a failing exit code
/// themselves rather than have it thrown).
public struct GitProcessResult: Sendable, Equatable {
    public let exitCode: Int32
    public let standardOutput: String
    public let standardError: String

    public init(exitCode: Int32, standardOutput: String, standardError: String) {
        self.exitCode = exitCode
        self.standardOutput = standardOutput
        self.standardError = standardError
    }

    public var succeeded: Bool { exitCode == 0 }
}

/// What `GitRepository` needs from something that can run `git`. Extracted
/// so tests can inject a fake that returns canned output/exit codes without
/// touching a real filesystem or process — and so the UI layer, which only
/// ever sees `GitRepository`, never gets a chance to shell out itself.
///
/// `run` never throws for a non-zero exit — that is domain information
/// ("nothing to commit", a merge conflict) which `GitRepository` turns into
/// `GitError.commandFailed` with git's stderr attached. It throws only when
/// the process itself could not be run at all (git missing, spawn failure),
/// via `GitError.gitNotFound`.
public protocol GitRunning: Sendable {
    func run(_ arguments: [String], in directory: URL) async throws -> GitProcessResult
}
