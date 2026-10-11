import Foundation
import Darwin

/// Runs one bounded native OpenSSL command without a shell or inherited configuration.
internal final class CertificateProcess: @unchecked Sendable {
    private let executable: String
    private let lock = NSLock()
    private var isCancelled = false
    private var active: (process: Process, completion: DispatchGroup)?

    init(executable: String) { self.executable = executable }

    var canCleanup: Bool {
        lock.lock(); defer { lock.unlock() }
        return active == nil || active!.completion.wait(timeout: .now()) == .success
    }

    /// Stops admission atomically with process registration, then confirms child termination.
    func cancel() throws {
        lock.lock()
        isCancelled = true
        let child = active
        lock.unlock()
        if let child, !Self.stop(child.process, completion: child.completion) {
            throw LocalCertificateAuthorityError.processTerminationUnconfirmed
        }
    }

    /// Holds ownership until the actual child exit if SIGKILL could not be confirmed.
    func whenTerminated(_ action: @escaping @Sendable () -> Void) {
        lock.lock()
        let child = active
        lock.unlock()
        if let child { child.completion.notify(queue: .global(qos: .utility), execute: action) }
        else { action() }
    }

    func run(_ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = ["PATH": "/usr/bin:/bin", "LC_ALL": "C"]
        let output = Pipe(), errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        let finished = DispatchGroup()
        finished.enter()
        process.terminationHandler = { _ in finished.leave() }
        lock.lock()
        guard !isCancelled else {
            lock.unlock()
            throw LocalCertificateAuthorityError.closed
        }
        active = (process, finished)
        do { try process.run() }
        catch {
            active = nil
            lock.unlock()
            throw LocalCertificateAuthorityError.certificateOperationFailed
        }
        lock.unlock()
        defer {
            lock.lock()
            if finished.wait(timeout: .now()) == .success { active = nil }
            lock.unlock()
        }
        let captured = CertificateOutput()
        let drains = DispatchGroup()
        for (handle, retain) in [(output.fileHandleForReading, true), (errors.fileHandleForReading, false)] {
            drains.enter()
            DispatchQueue.global(qos: .utility).async {
                while true {
                    let data = handle.readData(ofLength: 4096)
                    if data.isEmpty { break }
                    if retain { captured.append(data) }
                }
                drains.leave()
            }
        }
        if finished.wait(timeout: .now() + 15) == .timedOut {
            guard Self.stop(process, completion: finished) else {
                throw LocalCertificateAuthorityError.processTerminationUnconfirmed
            }
            _ = drains.wait(timeout: .now() + 2)
            throw LocalCertificateAuthorityError.processTimedOut
        }
        _ = drains.wait(timeout: .now() + 2)
        lock.lock()
        let cancelled = isCancelled
        lock.unlock()
        if cancelled { throw LocalCertificateAuthorityError.closed }
        guard process.terminationStatus == 0 else {
            // OpenSSL diagnostics can contain private paths; deliberately do not return them.
            throw LocalCertificateAuthorityError.certificateOperationFailed
        }
        return captured.string
    }

    private static func stop(_ process: Process, completion: DispatchGroup) -> Bool {
        if completion.wait(timeout: .now()) == .success { return true }
        if process.isRunning { process.terminate() }
        if completion.wait(timeout: .now() + 1) == .success { return true }
        if process.isRunning { Darwin.kill(process.processIdentifier, SIGKILL) }
        return completion.wait(timeout: .now() + 2) == .success
    }
}

private final class CertificateOutput: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()
    func append(_ bytes: Data) {
        lock.lock(); defer { lock.unlock() }
        data.append(bytes.prefix(max(0, 65_536 - data.count)))
    }
    var string: String {
        lock.lock(); defer { lock.unlock() }
        return String(decoding: data, as: UTF8.self)
    }
}
