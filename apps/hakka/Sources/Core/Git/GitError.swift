import Foundation

/// Every way a git operation can fail, typed so callers can pattern-match
/// instead of string-sniffing an `NSError` or a bare exit code.
///
/// This is the payoff of the "diagnosable, not silent" requirement: `.commandFailed`
/// always carries git's own stderr, so a failed commit or push shows the user
/// git's real message ("nothing to commit", "failed to push some refs", a
/// merge conflict) rather than a generic "something went wrong".
public enum GitError: Error, Sendable, Equatable, LocalizedError {
    /// The configured git executable (normally `/usr/bin/git`) is missing or
    /// not executable. Distinct from `commandFailed` because it means no
    /// process ever ran — there is no stderr to show.
    case gitNotFound
    /// `directory` has no `.git` — surfaced explicitly rather than letting
    /// every git subcommand fail with its own "not a git repository" text,
    /// so callers can offer "Initialize Git" instead of a raw error.
    case notARepository(path: String)
    /// `git <arguments>` ran to completion and exited non-zero. `stderr` is
    /// git's own diagnostic, verbatim.
    case commandFailed(arguments: [String], exitCode: Int32, stderr: String)
    /// git wrote bytes that were not valid UTF-8 to the stream this call
    /// needed to parse (should be unreachable for the plumbing commands this
    /// type uses, which are documented UTF-8/ASCII, but decoding as UTF-8
    /// with replacement characters would silently corrupt a path instead of
    /// surfacing the problem).
    case invalidUTF8Output(arguments: [String])
    /// The operation was cancelled (its `Task` was cancelled) before git
    /// finished — expected for a user-initiated pull/push cancel, not a
    /// failure to report as one.
    case cancelled
    /// `value` starts with `-` and was rejected before git ever ran it —
    /// see the comment on `GitRepository.pull`'s internal guard for why a
    /// leading `--` in this call's own argv is not enough by itself for a
    /// remote or branch value specifically.
    case unsafeArgument(field: String, value: String)

    public var errorDescription: String? {
        switch self {
        case .gitNotFound:
            "git was not found. Install the Xcode Command Line Tools (`xcode-select --install`) or Git."
        case let .notARepository(path):
            "\(path) is not a git repository."
        case let .commandFailed(arguments, exitCode, stderr):
            Self.commandFailedDescription(arguments: arguments, exitCode: exitCode, stderr: stderr)
        case let .invalidUTF8Output(arguments):
            "git \(arguments.joined(separator: " ")) produced output that was not valid UTF-8."
        case .cancelled:
            "The git operation was cancelled."
        case let .unsafeArgument(field, value):
            "\"\(value)\" can't be used as a \(field) — it looks like a command-line option, and git doesn't always guard against that internally."
        }
    }

    private static func commandFailedDescription(arguments: [String], exitCode: Int32, stderr: String) -> String {
        let trimmed = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        let command = "git \(arguments.joined(separator: " "))"
        return trimmed.isEmpty
            ? "\(command) failed (exit code \(exitCode))."
            : "\(command) failed: \(trimmed)"
    }
}
