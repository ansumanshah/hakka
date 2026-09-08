import AppKit
import Darwin
import Observation

@MainActor
@Observable
final class ProxyCaptureModel {
    enum State: Equatable { case stopped, starting, running, stopping, failed }

    var cliPath: String
    var nodePath: String
    var port = 8080
    var allowLAN = false
    var allowAgentControl = false
    var mappings = ProxyMappingFile()
    private(set) var state = State.stopped
    private(set) var message = "Capture traffic from an app or device configured to use this proxy."
    private(set) var certificatePath: String?
    private(set) var capturedCount = 0
    private(set) var lastError: String?
    @ObservationIgnored private var process: Process?
    @ObservationIgnored private var reader: Task<Void, Never>?
    @ObservationIgnored private var stopDeadline: Task<Void, Never>?
    @ObservationIgnored private let defaults: UserDefaults
    let configurationDirectory: URL

    init(defaults: UserDefaults = .standard, directory: URL? = nil) {
        self.defaults = defaults
        configurationDirectory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Hakka/Proxy", isDirectory: true)
        cliPath = defaults.string(forKey: "hakka.proxy.cli") ?? Self.findCLI()
        nodePath = defaults.string(forKey: "hakka.proxy.node") ?? Self.findNode()
        if let data = try? Data(contentsOf: configurationDirectory.appendingPathComponent("mappings.json")),
           let saved = try? JSONDecoder().decode(ProxyMappingFile.self, from: data) { mappings = saved }
    }

    var isActive: Bool { process?.isRunning == true || state == .starting || state == .running || state == .stopping }
    var mappingURL: URL { configurationDirectory.appendingPathComponent("mappings.json") }

    func start(bridgePort: UInt16 = 8989) {
        guard !isActive else { return }
        lastError = nil
        certificatePath = nil
        guard (1...65535).contains(port) else { fail("Choose a port between 1 and 65535."); return }
        guard FileManager.default.fileExists(atPath: cliPath) else { fail("Choose the installed Hakka CLI or its built cli.mjs file."); return }
        do {
            try FileManager.default.createDirectory(at: configurationDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try mappings.write(to: mappingURL)
            defaults.set(cliPath, forKey: "hakka.proxy.cli")
            defaults.set(nodePath, forKey: "hakka.proxy.node")
            var arguments = ["proxy", "--json", "--port", String(port), "--config-dir", configurationDirectory.path,
                             "--bridge-url", "ws://127.0.0.1:\(bridgePort)"]
            if allowLAN { arguments.append("--allow-lan") }
            if FileManager.default.fileExists(atPath: mappingURL.path) { arguments += ["--map-config", mappingURL.path] }
            let usesNode = cliPath.hasSuffix(".mjs") || cliPath.hasSuffix(".js")
            let executable = URL(fileURLWithPath: usesNode ? nodePath : cliPath)
            if usesNode { arguments.insert(cliPath, at: 0) }
            state = .starting
            message = "Starting proxy…"
            capturedCount = 0
            let (child, events) = try ProxyProcessStream.launch(executable: executable, arguments: arguments)
            process = child
            reader = Task { [weak self] in
                for await event in events {
                    guard let self else { return }
                    consume(event)
                }
            }
        } catch { fail(error.localizedDescription) }
    }

    func stop() {
        guard let process, process.isRunning else { return }
        state = .stopping
        message = "Stopping proxy…"
        process.terminate()
        stopDeadline?.cancel()
        stopDeadline = Task { [weak self, process] in
            do { try await Task.sleep(for: .seconds(5)) } catch { return }
            guard self?.process === process, process.isRunning else { return }
            kill(process.processIdentifier, SIGKILL)
        }
    }

    func shutdown() async {
        stop()
        for _ in 0..<50 {
            guard process?.isRunning == true else { return }
            try? await Task.sleep(for: .milliseconds(100))
        }
        if let process, process.isRunning { kill(process.processIdentifier, SIGKILL) }
    }

    func consume(_ event: ProxyProcessEvent) {
        switch event {
        case let .status(status):
            if let count = status.records { capturedCount = count }
            if let certificates = status.certificates, certificates.publicCaExists { certificatePath = certificates.publicCaPath }
            switch status.status {
            case "started":
                state = .running
                message = "Listening on \(status.host ?? "127.0.0.1"):\(status.port ?? port)"
            case "stopped":
                state = .stopped
                message = "Stopped · \(capturedCount) captured requests"
            case "error": fail(status.message ?? "Proxy failed.")
            case "diagnostic": message = status.message ?? message
            default: break
            }
        case let .failure(reason):
            stop()
            fail(reason)
        case let .exited(code):
            stopDeadline?.cancel()
            stopDeadline = nil
            process = nil
            reader = nil
            if state != .failed {
                if code == 0 || state == .stopping {
                    state = .stopped
                    message = "Stopped · \(capturedCount) captured requests"
                } else { fail("The proxy exited with code \(code).") }
            }
        }
    }

    private func fail(_ reason: String) { state = .failed; message = reason; lastError = reason }

    private static func findNode() -> String {
        ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/opt/homebrew/bin/node"
    }

    private static func findCLI() -> String {
        var directory = Bundle.main.bundleURL.deletingLastPathComponent()
        for _ in 0..<5 {
            let candidate = directory.appendingPathComponent("packages/hakka-cli/dist/cli.mjs").path
            if FileManager.default.fileExists(atPath: candidate) { return candidate }
            directory.deleteLastPathComponent()
        }
        return ["/opt/homebrew/bin/hakka", "/usr/local/bin/hakka"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? ""
    }
}
