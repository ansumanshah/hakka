import Foundation

/// The real `GitRunning` — spawns `/usr/bin/git` via `Process` with an
/// argument array, never a shell. `arguments: [String]` on `Process` means
/// each element reaches `execve` as its own argv entry: there is no shell to
/// re-tokenize a string, so nothing built from user text (a branch name, a
/// path, a commit message) can ever be interpreted as a second command or a
/// glob. The one residual risk argv arrays don't close — a leading `-`
/// making git itself read a value as a flag — is `GitRepository`'s job to
/// guard with `--`, not this type's.
public struct ProcessGitRunner: GitRunning {
    private let executableURL: URL

    public init(executableURL: URL = URL(fileURLWithPath: "/usr/bin/git")) {
        self.executableURL = executableURL
    }

    public func run(_ arguments: [String], in directory: URL) async throws -> GitProcessResult {
        guard FileManager.default.isExecutableFile(atPath: executableURL.path) else {
            throw GitError.gitNotFound
        }

        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments
        process.currentDirectoryURL = directory
        process.environment = Self.environment()

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe
        // Never read from stdin — a `git` that unexpectedly wants input
        // (e.g. a credential prompt `GIT_TERMINAL_PROMPT=0` didn't suppress)
        // fails fast against a closed pipe instead of hanging the caller.
        process.standardInput = FileHandle.nullDevice

        let (exits, exitContinuation) = AsyncStream<Int32>.makeStream(bufferingPolicy: .bufferingNewest(1))
        process.terminationHandler = { process in
            exitContinuation.yield(process.terminationStatus)
            exitContinuation.finish()
        }
        try Task.checkCancellation()
        do {
            try process.run()
        } catch {
            throw GitError.gitNotFound
        }

        // `Process.run()` dup2's each pipe's write end into the child but
        // leaves *this* process holding its own reference to that same
        // write end via `Pipe.fileHandleForWriting` — a well-known `Process`
        // gotcha. Left open, `readDataToEndOfFile()` below waits for every
        // writer to close, including this parent-side one that will never
        // write anything, so it blocks forever even after the child exits.
        // Closing our copy immediately after launch means EOF depends only
        // on the child's own fd, which closes when it does.
        try? stdoutPipe.fileHandleForWriting.close()
        try? stderrPipe.fileHandleForWriting.close()

        return try await withTaskCancellationHandler {
            // Both pipes are drained concurrently, not sequentially: reading
            // stdout to EOF before touching stderr would deadlock the moment
            // git writes enough to stderr to fill its pipe buffer (64KB)
            // while blocked because nobody is reading it yet — a real
            // failure mode for e.g. a noisy `push` that writes progress to
            // stderr while also producing stdout.
            async let stdoutData = Self.readAll(stdoutPipe.fileHandleForReading)
            async let stderrData = Self.readAll(stderrPipe.fileHandleForReading)
            let (outData, errData) = await (stdoutData, stderrData)

            if Task.isCancelled {
                throw GitError.cancelled
            }
            for await exitCode in exits {
                return GitProcessResult(
                    exitCode: exitCode,
                    standardOutput: String(decoding: outData, as: UTF8.self),
                    standardError: String(decoding: errData, as: UTF8.self),
                )
            }
            throw GitError.cancelled
        } onCancel: {
            // SIGTERM, not `interrupt()` — git handles TERM by giving up
            // its current operation (including a partial fetch/push) rather
            // than leaving an index lock behind, which is what matters for
            // a cancel to actually unblock a follow-up call against the
            // same repository.
            if process.isRunning { process.terminate() }
        }
    }

    /// `DispatchQueue.global`, not `Task.detached` — a blocking synchronous
    /// call like `readDataToEndOfFile()` inside `Task.detached` still ties
    /// up one of Swift's small, fixed-size cooperative executor threads for
    /// as long as the read blocks. Enough concurrent `GitRepository` calls
    /// in flight at once (parallel test execution surfaced this: every test
    /// spawns its own repository, and Swift Testing runs many concurrently)
    /// exhausts that pool — including threads unrelated `await`s across the
    /// whole process need — and the app deadlocks with every pending git
    /// call stuck at 0% CPU. GCD's global queue keeps its own, much more
    /// elastic thread pool, so parking a blocking read there never starves
    /// Swift's cooperative scheduler.
    private static func readAll(_ handle: FileHandle) async -> Data {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                continuation.resume(returning: handle.readDataToEndOfFile())
            }
        }
    }

    /// `GIT_TERMINAL_PROMPT=0` + a no-op askpass turns a missing credential
    /// into an immediate failure instead of a hang waiting for terminal
    /// input this process will never receive. `GIT_PAGER=cat` stops git
    /// from invoking `less` on output this code is about to parse.
    private static func environment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["GIT_PAGER"] = "cat"
        env["GIT_ASKPASS"] = "/usr/bin/true"
        return env
    }
}
