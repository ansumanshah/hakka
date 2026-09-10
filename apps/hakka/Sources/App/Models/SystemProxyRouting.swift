import Darwin
import Foundation

struct SystemProxyCommandResult: Sendable, Equatable {
    let stdout: String
    let stderr: String
}

protocol SystemProxyCommandTransport: Sendable {
    func run(arguments: [String]) async throws -> SystemProxyCommandResult
}

enum SystemProxyCommandError: LocalizedError, Equatable {
    case failed(Int32, String)
    case timedOut

    var errorDescription: String? {
        switch self {
        case let .failed(status, output): "networksetup exited with status \(status): \(output)"
        case .timedOut: "networksetup timed out"
        }
    }
}

/// Runs Apple's networksetup with an argument vector. It never invokes a shell.
struct NetworkSetupTransport: SystemProxyCommandTransport {
    private let timeout: Duration

    init(timeout: Duration = .seconds(8)) {
        self.timeout = timeout
    }

    func run(arguments: [String]) async throws -> SystemProxyCommandResult {
        let timeoutSeconds = max(1, Int(timeout.components.seconds))
        return try await Task.detached(priority: .userInitiated) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/networksetup")
            process.arguments = arguments
            let output = Pipe()
            let errors = Pipe()
            process.standardOutput = output
            process.standardError = errors
            try process.run()
            async let outputData = Task.detached { Self.drain(output.fileHandleForReading) }.value
            async let errorData = Task.detached { Self.drain(errors.fileHandleForReading) }.value
            let deadline = DispatchTime.now() + .seconds(timeoutSeconds)
            while process.isRunning, DispatchTime.now() < deadline {
                try? await Task.sleep(for: .milliseconds(20))
            }
            guard !process.isRunning else {
                process.terminate()
                try? await Task.sleep(for: .milliseconds(250))
                if process.isRunning {
                    kill(process.processIdentifier, SIGKILL)
                }
                while process.isRunning {
                    try? await Task.sleep(for: .milliseconds(10))
                }
                _ = await (outputData, errorData)
                throw SystemProxyCommandError.timedOut
            }
            let stdout = String(decoding: await outputData, as: UTF8.self)
            let stderr = String(decoding: await errorData, as: UTF8.self)
            guard process.terminationStatus == 0 else {
                throw SystemProxyCommandError.failed(process.terminationStatus, stderr.isEmpty ? stdout : stderr)
            }
            return SystemProxyCommandResult(stdout: stdout, stderr: stderr)
        }.value
    }

    private static func drain(_ handle: FileHandle) -> Data {
        var retained = Data()
        while let chunk = try? handle.read(upToCount: 4096), !chunk.isEmpty {
            if retained.count < 65536 {
                retained.append(chunk.prefix(65536 - retained.count))
            }
        }
        return retained
    }
}

struct SystemProxyEndpoint: Codable, Equatable, Sendable {
    var enabled: Bool
    var host: String
    var port: Int
    var authenticationEnabled: Bool
}

struct SystemProxyServiceSnapshot: Codable, Equatable, Sendable {
    let service: String
    let http: SystemProxyEndpoint
    let https: SystemProxyEndpoint
}

struct SystemProxyJournal: Codable, Sendable {
    let port: Int
    let services: [SystemProxyServiceSnapshot]
    var expected: [String: SystemProxyExpected]
    var pending: [String: SystemProxyExpected]
}

struct SystemProxyExpected: Codable, Sendable {
    var http: SystemProxyEndpoint
    var https: SystemProxyEndpoint
}

enum SystemProxyRoutingError: LocalizedError, Equatable {
    case authenticationUnsupported(String)
    case noServices
    case recoveryRequired
    case command(String)

    var errorDescription: String? {
        switch self {
        case let .authenticationUnsupported(service):
            "\(service) uses proxy authentication. Hakka leaves this service unchanged because its credentials cannot be restored safely."
        case .noServices: "No enabled macOS network services were available to route."
        case .recoveryRequired: "A previous system-proxy session still needs restoration. Recover it before starting capture."
        case let .command(message): message
        }
    }
}

/// Opt-in router for HTTP and HTTPS macOS proxy settings. A durable snapshot is
/// written before any mutation and restoration only touches settings still owned
/// by this Hakka session.
actor SystemProxyRouter {
    private let transport: any SystemProxyCommandTransport
    private let journalURL: URL
    private var transactionActive = false
    private var transactionWaiters: [CheckedContinuation<Void, Never>] = []

    init(transport: any SystemProxyCommandTransport = NetworkSetupTransport(), journalURL: URL) {
        self.transport = transport
        self.journalURL = journalURL
    }

    func apply(port: Int) async throws {
        await acquireTransaction()
        defer { releaseTransaction() }
        guard !FileManager.default.fileExists(atPath: journalURL.path) else { throw SystemProxyRoutingError.recoveryRequired }
        let services = try await snapshots()
        guard !services.isEmpty else { throw SystemProxyRoutingError.noServices }
        if let protectedService = services.first(where: { $0.http.authenticationEnabled || $0.https.authenticationEnabled }) {
            throw SystemProxyRoutingError.authenticationUnsupported(protectedService.service)
        }
        var journal = SystemProxyJournal(
            port: port,
            services: services,
            expected: Dictionary(uniqueKeysWithValues: services.map { ($0.service, SystemProxyExpected(http: $0.http, https: $0.https)) }),
            pending: [:]
        )
        try writeJournal(journal)
        do {
            for service in services {
                try await route(service: service.service, port: port, journal: &journal)
            }
        } catch {
            let warning = await restore(journal)
            if let warning {
                throw SystemProxyRoutingError.command("\(error.localizedDescription) Restoration remains pending: \(warning)")
            }
            throw error
        }
    }

    /// Restores this session's routes. A setting changed by the user after Hakka
    /// applied its route is deliberately left alone.
    func restore() async -> String? {
        await acquireTransaction()
        defer { releaseTransaction() }
        guard FileManager.default.fileExists(atPath: journalURL.path) else { return nil }
        guard let journal = readJournal() else { return "The system-proxy recovery journal cannot be read and was left in place." }
        return await restore(journal)
    }

    private func restore(_ savedJournal: SystemProxyJournal) async -> String? {
        var journal = savedJournal
        var warnings: [String] = []
        for service in journal.services {
            do {
                try await restore(service, journal: &journal)
            } catch { warnings.append("\(service.service): \(error.localizedDescription)") }
        }
        if warnings.isEmpty {
            removeJournal()
        }
        return warnings.isEmpty ? nil : warnings.joined(separator: " ")
    }

    /// Reconciles a journal left by a crash or forced quit. It has the same
    /// ownership check as a normal stop, so a newer user configuration wins.
    func recover() async -> String? {
        await restore()
    }

    func hasPendingRecovery() -> Bool {
        FileManager.default.fileExists(atPath: journalURL.path)
    }

    private func acquireTransaction() async {
        if !transactionActive {
            transactionActive = true; return
        }
        await withCheckedContinuation { transactionWaiters.append($0) }
    }

    private func releaseTransaction() {
        if transactionWaiters.isEmpty {
            transactionActive = false
        } else {
            transactionWaiters.removeFirst().resume()
        }
    }

    private func snapshots() async throws -> [SystemProxyServiceSnapshot] {
        let result: SystemProxyCommandResult
        do { result = try await transport.run(arguments: ["-listallnetworkservices"]) }
        catch { throw SystemProxyRoutingError.command(error.localizedDescription) }
        let services = result.stdout.split(separator: "\n").map(String.init).filter { !$0.isEmpty && !$0.hasPrefix("*") && !$0.hasPrefix("An asterisk") }
        var snapshots: [SystemProxyServiceSnapshot] = []
        for service in services {
            do {
                async let http = endpoint("-getwebproxy", service)
                async let https = endpoint("-getsecurewebproxy", service)
                try snapshots.append(await SystemProxyServiceSnapshot(service: service, http: http, https: https))
            } catch {
                throw SystemProxyRoutingError.command("Could not inspect \(service): \(error.localizedDescription)")
            }
        }
        return snapshots
    }

    private func endpoint(_ command: String, _ service: String) async throws -> SystemProxyEndpoint {
        let output = try await transport.run(arguments: [command, service]).stdout
        var fields: [String: String] = [:]
        for line in output.split(separator: "\n") {
            guard let separator = line.firstIndex(of: ":") else { continue }
            let key = line[..<separator].trimmingCharacters(in: .whitespaces)
            guard fields[key] == nil else { throw SystemProxyRoutingError.command("Duplicate networksetup field: \(key)") }
            fields[key] = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
        }
        let booleans = ["Yes": true, "No": false, "1": true, "0": false]
        guard let enabled = fields["Enabled"].flatMap({ booleans[$0] }),
              let authenticated = fields["Authenticated Proxy Enabled"].flatMap({ booleans[$0] }),
              let host = fields["Server"], let port = fields["Port"].flatMap(Int.init), (0 ... 65535).contains(port)
        else { throw SystemProxyRoutingError.command("Incomplete networksetup settings for \(service).") }
        return SystemProxyEndpoint(enabled: enabled, host: host, port: port, authenticationEnabled: authenticated)
    }

    private func route(service: String, port: Int, journal: inout SystemProxyJournal) async throws {
        try stage(&journal, service: service) { $0.http = SystemProxyEndpoint(enabled: $0.http.enabled, host: "127.0.0.1", port: port, authenticationEnabled: false) }
        try await command(["-setwebproxy", service, "127.0.0.1", String(port)])
        try commit(&journal, service: service)
        try stage(&journal, service: service) { $0.http = SystemProxyEndpoint(enabled: true, host: "127.0.0.1", port: port, authenticationEnabled: false) }
        try await command(["-setwebproxystate", service, "on"])
        try commit(&journal, service: service)
        try stage(&journal, service: service) { $0.https = SystemProxyEndpoint(enabled: $0.https.enabled, host: "127.0.0.1", port: port, authenticationEnabled: false) }
        try await command(["-setsecurewebproxy", service, "127.0.0.1", String(port)])
        try commit(&journal, service: service)
        try stage(&journal, service: service) { $0.https = SystemProxyEndpoint(enabled: true, host: "127.0.0.1", port: port, authenticationEnabled: false) }
        try await command(["-setsecurewebproxystate", service, "on"])
        try commit(&journal, service: service)
    }

    private func stage(_ journal: inout SystemProxyJournal, service: String, _ update: (inout SystemProxyExpected) -> Void) throws {
        guard var next = journal.expected[service] else { throw SystemProxyRoutingError.command("Missing journal entry for \(service).") }
        update(&next)
        journal.pending[service] = next
        try writeJournal(journal)
    }

    private func commit(_ journal: inout SystemProxyJournal, service: String) throws {
        guard let next = journal.pending[service] else { throw SystemProxyRoutingError.command("Missing staged journal entry for \(service).") }
        journal.expected[service] = next
        journal.pending.removeValue(forKey: service)
        try writeJournal(journal)
    }

    private func restore(_ snapshot: SystemProxyServiceSnapshot, journal: inout SystemProxyJournal) async throws {
        guard let expected = journal.expected[snapshot.service] else { return }
        let pending = journal.pending[snapshot.service]
        let http = try await endpoint("-getwebproxy", snapshot.service)
        let https = try await endpoint("-getsecurewebproxy", snapshot.service)
        let ownsHTTP = (expected.http != snapshot.http && http == expected.http) || (pending?.http != snapshot.http && http == pending?.http)
        let ownsHTTPS = (expected.https != snapshot.https && https == expected.https) || (pending?.https != snapshot.https && https == pending?.https)
        guard ownsHTTP || ownsHTTPS else { return }
        // A crash may leave the durable intended state in `pending` even though
        // networksetup already changed it. Commit that observed state before
        // recording the inverse transition.
        var observed = expected
        if ownsHTTP {
            observed.http = http
        }
        if ownsHTTPS {
            observed.https = https
        }
        journal.expected[snapshot.service] = observed
        journal.pending.removeValue(forKey: snapshot.service)
        try writeJournal(journal)
        if ownsHTTP {
            try await restoreHTTP(snapshot, journal: &journal)
        }
        if ownsHTTPS {
            try await restoreHTTPS(snapshot, journal: &journal)
        }
    }

    private func restoreHTTP(_ snapshot: SystemProxyServiceSnapshot, journal: inout SystemProxyJournal) async throws {
        try stage(&journal, service: snapshot.service) { $0.http = SystemProxyEndpoint(enabled: $0.http.enabled, host: snapshot.http.host, port: snapshot.http.port, authenticationEnabled: false) }
        try await command(["-setwebproxy", snapshot.service, snapshot.http.host, String(snapshot.http.port)])
        try commit(&journal, service: snapshot.service)
        try stage(&journal, service: snapshot.service) { $0.http = snapshot.http }
        try await command(["-setwebproxystate", snapshot.service, snapshot.http.enabled ? "on" : "off"])
        try commit(&journal, service: snapshot.service)
    }

    private func restoreHTTPS(_ snapshot: SystemProxyServiceSnapshot, journal: inout SystemProxyJournal) async throws {
        try stage(&journal, service: snapshot.service) { $0.https = SystemProxyEndpoint(enabled: $0.https.enabled, host: snapshot.https.host, port: snapshot.https.port, authenticationEnabled: false) }
        try await command(["-setsecurewebproxy", snapshot.service, snapshot.https.host, String(snapshot.https.port)])
        try commit(&journal, service: snapshot.service)
        try stage(&journal, service: snapshot.service) { $0.https = snapshot.https }
        try await command(["-setsecurewebproxystate", snapshot.service, snapshot.https.enabled ? "on" : "off"])
        try commit(&journal, service: snapshot.service)
    }

    private func command(_ arguments: [String]) async throws {
        do { _ = try await transport.run(arguments: arguments) }
        catch { throw SystemProxyRoutingError.command(error.localizedDescription) }
    }

    private func writeJournal(_ journal: SystemProxyJournal) throws {
        try FileManager.default.createDirectory(at: journalURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(journal).write(to: journalURL, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: journalURL.path)
    }

    private func readJournal() -> SystemProxyJournal? {
        guard let data = try? Data(contentsOf: journalURL) else { return nil }
        return try? JSONDecoder().decode(SystemProxyJournal.self, from: data)
    }

    private func removeJournal() {
        try? FileManager.default.removeItem(at: journalURL)
    }
}
