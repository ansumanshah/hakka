import CryptoKit
import Darwin
import Foundation
import Security

struct SimulatorSetupTarget: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let state: String
    var isBooted: Bool {
        state == "Booted"
    }
}

struct SimulatorSetupFailure: LocalizedError {
    let message: String
    var errorDescription: String? {
        message
    }
}

/// Closing the descriptor releases this process's exclusive Simulator reservation.
final class SimulatorSetupReservation: @unchecked Sendable {
    private let lock = NSLock()
    private var descriptor: Int32?
    private var released = false

    init(descriptor: Int32? = nil) {
        self.descriptor = descriptor
    }

    var isReleased: Bool {
        lock.withLock { released }
    }

    func release() {
        lock.withLock {
            if let descriptor {
                _ = Darwin.close(descriptor)
            }
            descriptor = nil
            released = true
        }
    }

    deinit {
        if let descriptor {
            _ = Darwin.close(descriptor)
        }
    }
}

@MainActor
protocol SimulatorSetupRunning {
    func discoverTargets() async throws -> [SimulatorSetupTarget]
    func reserve(targetID: String, directory: URL) throws -> SimulatorSetupReservation
    func boot(targetID: String) async throws
    func certificateFingerprint(path: String) throws -> String
    func installCertificate(targetID: String, path: String) async throws
    func openSafari(targetID: String, url: URL) async throws
    func pause() async throws
}

/// Every mutating command names the exact target selected by the user.
@MainActor
final class SimulatorSetupRuntime: SimulatorSetupRunning {
    typealias Runner = @Sendable (String, [String], TimeInterval) async throws -> Data
    private let run: Runner

    init(run: @escaping Runner = SimulatorSetupRuntime.runCommand) {
        self.run = run
    }

    func discoverTargets() async throws -> [SimulatorSetupTarget] {
        struct Device: Decodable {
            let udid: String
            let name: String
            let state: String
            let isAvailable: Bool?
        }
        struct Inventory: Decodable { let devices: [String: [Device]] }
        let data = try await run("/usr/bin/xcrun", ["simctl", "list", "devices", "available", "--json"], 15)
        let inventory = try JSONDecoder().decode(Inventory.self, from: data)
        return inventory.devices.filter { $0.key.contains("iOS") }.flatMap(\.value)
            .filter { $0.isAvailable == true && UUID(uuidString: $0.udid) != nil }
            .map { SimulatorSetupTarget(id: $0.udid, name: $0.name, state: $0.state) }
            .sorted { $0.name == $1.name ? $0.id < $1.id : $0.name < $1.name }
    }

    func reserve(targetID: String, directory: URL) throws -> SimulatorSetupReservation {
        try validate(targetID)
        let reservations = directory.appendingPathComponent("SimulatorReservations", isDirectory: true)
        try FileManager.default.createDirectory(at: reservations, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let path = reservations.appendingPathComponent(targetID.lowercased() + ".lock").path
        let descriptor = Darwin.open(path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw SimulatorSetupFailure(message: "Could not reserve this Simulator for setup.") }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            _ = Darwin.close(descriptor)
            throw SimulatorSetupFailure(message: "This Simulator is already reserved by another Hakka setup session.")
        }
        return SimulatorSetupReservation(descriptor: descriptor)
    }

    func boot(targetID: String) async throws {
        try validate(targetID)
        _ = try await run("/usr/bin/xcrun", ["simctl", "boot", targetID], 20)
        _ = try await run("/usr/bin/xcrun", ["simctl", "bootstatus", targetID, "-b"], 60)
    }

    func certificateFingerprint(path: String) throws -> String {
        let pem = try String(contentsOfFile: path, encoding: .utf8)
        guard let begin = pem.range(of: "-----BEGIN CERTIFICATE-----"),
              let end = pem.range(of: "-----END CERTIFICATE-----", range: begin.upperBound ..< pem.endIndex),
              let der = Data(base64Encoded: String(pem[begin.upperBound ..< end.lowerBound]), options: .ignoreUnknownCharacters),
              !pem.contains("PRIVATE KEY"), SecCertificateCreateWithData(nil, der as CFData) != nil
        else {
            throw SimulatorSetupFailure(message: "The public CA certificate is missing or unreadable.")
        }
        return SHA256.hash(data: der).map { String(format: "%02X", $0) }.joined(separator: ":")
    }

    func installCertificate(targetID: String, path: String) async throws {
        try validate(targetID)
        _ = try await run("/usr/bin/xcrun", ["simctl", "keychain", targetID, "add-root-cert", path], 20)
    }

    func openSafari(targetID: String, url: URL) async throws {
        try validate(targetID)
        // Bring Safari forward before the URL handoff; the URL itself carries the proof nonce.
        _ = try await run("/usr/bin/xcrun", ["simctl", "launch", targetID, "com.apple.mobilesafari"], 15)
        _ = try await run("/usr/bin/xcrun", ["simctl", "openurl", targetID, url.absoluteString], 15)
    }

    func pause() async throws {
        try await Task.sleep(for: .milliseconds(100))
    }

    private func validate(_ id: String) throws {
        guard UUID(uuidString: id) != nil else { throw SimulatorSetupFailure(message: "Select an exact available Simulator before setup.") }
    }

    nonisolated static func runCommand(executable: String, arguments: [String], timeout: TimeInterval) async throws -> Data {
        let execution = SimulatorCommandExecution()
        return try await withTaskCancellationHandler {
            try await Task.detached(priority: .utility) {
                try execution.run(executable: executable, arguments: arguments, timeout: timeout)
            }.value
        } onCancel: { execution.cancel() }
    }
}

/// File-backed output avoids pipe deadlocks, and the child is killed at a bounded deadline.
private final class SimulatorCommandExecution: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var cancelled = false

    func cancel() {
        lock.withLock {
            cancelled = true
            if let process, process.isRunning {
                kill(process.processIdentifier, SIGKILL)
            }
        }
    }

    func run(executable: String, arguments: [String], timeout: TimeInterval) throws -> Data {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("hakka-simulator-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let outputURL = directory.appendingPathComponent("output")
        guard FileManager.default.createFile(atPath: outputURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
            throw SimulatorSetupFailure(message: "Could not prepare Simulator command output.")
        }
        let output = try FileHandle(forWritingTo: outputURL)
        defer { try? output.close() }
        let child = Process()
        child.executableURL = URL(fileURLWithPath: executable)
        child.arguments = arguments
        child.standardInput = FileHandle.nullDevice
        child.standardOutput = output
        child.standardError = output
        try lock.withLock {
            guard !cancelled else { throw CancellationError() }
            try child.run()
            process = child
        }
        let deadline = Date().addingTimeInterval(timeout)
        while child.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        let timedOut = child.isRunning
        if timedOut {
            kill(child.processIdentifier, SIGKILL)
        }
        child.waitUntilExit()
        lock.withLock { process = nil }
        if lock.withLock({ cancelled }) {
            throw CancellationError()
        }
        if timedOut {
            throw SimulatorSetupFailure(message: "Simulator command timed out. Continue with manual setup.")
        }
        let input = try FileHandle(forReadingFrom: outputURL)
        defer { try? input.close() }
        let data = try input.read(upToCount: 2_000_001) ?? Data()
        guard data.count <= 2_000_000 else { throw SimulatorSetupFailure(message: "Simulator command output exceeded its limit.") }
        guard child.terminationStatus == 0 else {
            let detail = String(decoding: data.prefix(1000), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            throw SimulatorSetupFailure(message: "Simulator command failed: \(detail.isEmpty ? String(child.terminationStatus) : detail)")
        }
        return data
    }
}
