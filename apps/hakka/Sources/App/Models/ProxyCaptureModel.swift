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
    /// Routes this Mac through the local proxy after the sidecar confirms it is listening.
    var routeThisMac = false
    var allowAgentControl = false
    var enableBreakpoints = false
    var mappings = ProxyMappingFile()
    var tlsHostScope = TLSHostScope()
    var scriptConfiguration = ProxyScriptConfiguration()
    var bandwidthConfiguration = ProxyBandwidthConfiguration()
    let routingConfiguration: ProxyRoutingConfiguration
    private(set) var state = State.stopped
    private(set) var message = "Capture traffic from an app or device configured to use this proxy."
    private(set) var certificatePath: String?
    private(set) var capturedCount = 0
    private(set) var lastError: String?
    private(set) var connectionTest: ProxyConnectionProbe.Result?
    private(set) var isTestingConnection = false
    private(set) var isSystemProxyRoutingActive = false
    private(set) var isSystemProxyRoutingRecoveryPending = false
    private(set) var isRecoveringSystemProxyRouting = false
    @ObservationIgnored var onBreakpointReady: (@MainActor @Sendable () async -> Void)?
    @ObservationIgnored private var captureGeneration = UUID()
    @ObservationIgnored private var process: Process?
    @ObservationIgnored private var reader: Task<Void, Never>?
    @ObservationIgnored private var stopDeadline: Task<Void, Never>?
    @ObservationIgnored private var privateRoutingConfigurationURL: URL?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let systemProxyRouter: SystemProxyRouter
    let configurationDirectory: URL

    init(defaults: UserDefaults = .standard, directory: URL? = nil, systemProxyRouter: SystemProxyRouter? = nil) {
        self.defaults = defaults
        routingConfiguration = ProxyRoutingConfiguration(defaults: defaults)
        configurationDirectory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Hakka/Proxy", isDirectory: true)
        self.systemProxyRouter = systemProxyRouter ?? SystemProxyRouter(
            journalURL: configurationDirectory.appendingPathComponent("system-proxy-routing.json")
        )
        if let saved = defaults.data(forKey: "hakka.proxy.tlsScope"),
           let scope = try? JSONDecoder().decode(TLSHostScope.self, from: saved)
        {
            tlsHostScope = scope
        }
        if let saved = defaults.data(forKey: "hakka.proxy.bandwidth"),
           let configuration = try? JSONDecoder().decode(ProxyBandwidthConfiguration.self, from: saved)
        {
            bandwidthConfiguration = configuration
        }
        cliPath = defaults.string(forKey: "hakka.proxy.cli") ?? Self.findCLI()
        nodePath = defaults.string(forKey: "hakka.proxy.node") ?? Self.findNode()
        if let data = try? Data(contentsOf: configurationDirectory.appendingPathComponent("mappings.json")),
           let saved = try? JSONDecoder().decode(ProxyMappingFile.self, from: data)
        {
            mappings = saved
        }
    }

    var isActive: Bool {
        process?.isRunning == true || state == .starting || state == .running || state == .stopping
    }

    var mappingURL: URL {
        configurationDirectory.appendingPathComponent("mappings.json")
    }

    func start(bridgePort: UInt16 = 8989) {
        guard !isActive else { return }
        guard !isRecoveringSystemProxyRouting else {
            message = "Checking whether a previous system-proxy session needs restoration…"
            return
        }
        lastError = nil
        captureGeneration = UUID()
        connectionTest = nil
        certificatePath = nil
        guard (1 ... 65535).contains(port) else { fail("Choose a port between 1 and 65535."); return }
        if let message = tlsHostScope.validationMessage {
            fail(message); return
        }
        if let message = bandwidthConfiguration.validationMessage {
            fail(message); return
        }
        if case let .failure(error) = routingConfiguration.configurationData() {
            fail(error.localizedDescription); return
        }
        guard FileManager.default.fileExists(atPath: cliPath) else { fail("Choose the installed Hakka CLI or its built cli.mjs file."); return }
        do {
            let scriptPath = try scriptConfiguration.prepareForLaunch()
            try FileManager.default.createDirectory(at: configurationDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try removePrivateRoutingConfiguration()
            let routingURL = configurationDirectory.appendingPathComponent(".routing-\(captureGeneration.uuidString).json")
            try routingConfiguration.writeConfiguration(to: routingURL)
            privateRoutingConfigurationURL = routingURL
            try mappings.write(to: mappingURL)
            defaults.set(cliPath, forKey: "hakka.proxy.cli")
            defaults.set(nodePath, forKey: "hakka.proxy.node")
            try defaults.set(JSONEncoder().encode(tlsHostScope), forKey: "hakka.proxy.tlsScope")
            try defaults.set(JSONEncoder().encode(bandwidthConfiguration), forKey: "hakka.proxy.bandwidth")
            var arguments = ["proxy", "--json", "--port", String(port), "--config-dir", configurationDirectory.path,
                             "--bridge-url", "ws://127.0.0.1:\(bridgePort)", "--routing-config", routingURL.path]
            if let scriptPath {
                arguments += ["--script", scriptPath]
            }
            arguments += bandwidthArguments()
            if allowLAN {
                arguments.append("--allow-lan")
            }
            if enableBreakpoints {
                arguments.append("--breakpoints")
            }
            let tlsFlag = tlsHostScope.mode == .bypass ? "--tls-bypass-host" : "--tls-allow-host"
            for host in tlsHostScope.enabledHosts {
                arguments += [tlsFlag, host]
            }
            if FileManager.default.fileExists(atPath: mappingURL.path) {
                arguments += ["--map-config", mappingURL.path]
            }
            let usesNode = cliPath.hasSuffix(".mjs") || cliPath.hasSuffix(".js")
            let executable = URL(fileURLWithPath: usesNode ? nodePath : cliPath)
            if usesNode {
                arguments.insert(cliPath, at: 0)
            }
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
        } catch {
            cleanupPrivateRoutingConfiguration()
            fail(error.localizedDescription)
        }
    }

    func testConnection() async {
        guard state == .running, !isTestingConnection else { return }
        let generation = captureGeneration
        isTestingConnection = true
        connectionTest = nil
        let result = await ProxyConnectionProbe(port: port, certificatePath: certificatePath).run()
        isTestingConnection = false
        guard generation == captureGeneration, state == .running else { return }
        connectionTest = result
    }

    func stop() async -> Bool {
        cleanupPrivateRoutingConfiguration()
        guard let process, process.isRunning else {
            let warning = await systemProxyRouter.restore()
            isSystemProxyRoutingActive = false
            isSystemProxyRoutingRecoveryPending = await systemProxyRouter.hasPendingRecovery()
            return warning == nil && !isSystemProxyRoutingRecoveryPending
        }
        connectionTest = nil
        captureGeneration = UUID()
        state = .stopping
        message = "Stopping proxy…"
        if let warning = await systemProxyRouter.restore() {
            state = .running
            message = "Proxy remains running because system-proxy restoration needs attention: \(warning)"
            lastError = message
            isSystemProxyRoutingRecoveryPending = true
            return false
        }
        isSystemProxyRoutingActive = false
        isSystemProxyRoutingRecoveryPending = false
        process.terminate()
        stopDeadline?.cancel()
        stopDeadline = Task { [weak self, process] in
            do { try await Task.sleep(for: .seconds(5)) } catch { return }
            guard self?.process === process, process.isRunning else { return }
            kill(process.processIdentifier, SIGKILL)
        }
        return true
    }

    func shutdown() async -> Bool {
        guard await stop() else { return false }
        for _ in 0 ..< 50 {
            guard process?.isRunning == true else { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        if let process, process.isRunning {
            kill(process.processIdentifier, SIGKILL)
        }
        return true
    }

    func consume(_ event: ProxyProcessEvent) {
        switch event {
        case let .status(status):
            if let count = status.records {
                capturedCount = count
            }
            if let certificates = status.certificates, certificates.publicCaExists {
                certificatePath = certificates.publicCaPath
            }
            switch status.status {
            case "breakpoint-ready":
                guard isActive else { return }
                let generation = captureGeneration
                Task { [weak self] in
                    guard let self, generation == captureGeneration, isActive else { return }
                    await onBreakpointReady?()
                }
            case "started":
                cleanupPrivateRoutingConfiguration()
                state = .running
                message = "Listening on \(status.host ?? "127.0.0.1"):\(status.port ?? port)"
                routeThisMacIfRequested()
            case "stopped":
                cleanupPrivateRoutingConfiguration()
                state = .stopped
                message = "Stopped · \(capturedCount) captured requests"
            case "error":
                cleanupPrivateRoutingConfiguration()
                restoreSystemProxyRouting()
                fail(status.message ?? "Proxy failed.")
            case "diagnostic": message = status.message ?? message
            default: break
            }
        case let .failure(reason):
            Task { [weak self] in await self?.stop() }
            fail(reason)
        case let .exited(code):
            cleanupPrivateRoutingConfiguration()
            stopDeadline?.cancel()
            stopDeadline = nil
            process = nil
            reader = nil
            restoreSystemProxyRouting()
            if state != .failed {
                if code == 0 || state == .stopping {
                    state = .stopped
                    message = "Stopped · \(capturedCount) captured requests"
                } else {
                    fail("The proxy exited with code \(code).")
                }
            }
        }
    }

    private func fail(_ reason: String) {
        cleanupPrivateRoutingConfiguration()
        state = .failed; message = reason; lastError = reason
    }

    /// Called once at app launch before a new capture can apply a route.
    private var hasAttemptedRoutingRecovery = false

    func recoverSystemProxyRouting() async {
        guard !hasAttemptedRoutingRecovery else { return }
        hasAttemptedRoutingRecovery = true
        isRecoveringSystemProxyRouting = true
        defer { isRecoveringSystemProxyRouting = false }
        isSystemProxyRoutingRecoveryPending = await systemProxyRouter.hasPendingRecovery()
        if let warning = await systemProxyRouter.recover() {
            lastError = warning
            message = "System proxy recovery: \(warning)"
        }
        isSystemProxyRoutingActive = false
        isSystemProxyRoutingRecoveryPending = await systemProxyRouter.hasPendingRecovery()
    }

    func retrySystemProxyRoutingRecovery() async {
        guard !isActive, !isRecoveringSystemProxyRouting else { return }
        hasAttemptedRoutingRecovery = false
        await recoverSystemProxyRouting()
        if !isSystemProxyRoutingRecoveryPending {
            lastError = nil
            message = "Previous system proxy settings restored."
        }
    }

    func launchThroughProxy(executable: URL) throws {
        guard state == .running else { throw CocoaError(.executableNotLoadable) }
        _ = try ProxyScopedLauncher.launch(executable: executable, port: port, certificatePath: certificatePath)
    }

    func reportLaunchFailure(_ error: Error) {
        message = "Could not launch app: \(error.localizedDescription)"
        lastError = message
    }

    private func routeThisMacIfRequested() {
        guard routeThisMac else { return }
        let generation = captureGeneration
        let router = systemProxyRouter
        let routingPort = port
        Task { [weak self] in
            do {
                try await router.apply(port: routingPort)
                guard let self, self.captureGeneration == generation, self.state == .running else {
                    _ = await router.restore()
                    return
                }
                self.message = "Listening on 127.0.0.1:\(routingPort) · This Mac is routed through Hakka"
                self.isSystemProxyRoutingActive = true
            } catch {
                _ = await router.restore()
                guard let self, self.captureGeneration == generation else { return }
                self.isSystemProxyRoutingRecoveryPending = await router.hasPendingRecovery()
                self.fail("Could not route this Mac: \(error.localizedDescription)")
                _ = await self.stop()
            }
        }
    }

    private func restoreSystemProxyRouting() {
        Task { [weak self, systemProxyRouter] in
            _ = await systemProxyRouter.restore()
            let pending = await systemProxyRouter.hasPendingRecovery()
            guard let self else { return }
            self.isSystemProxyRoutingActive = false
            self.isSystemProxyRoutingRecoveryPending = pending
        }
    }

    func bandwidthArguments() -> [String] {
        let profile = switch bandwidthConfiguration.profile {
        case .none: "none"
        case .slow3G: "slow-3g"
        case .fast3G: "fast-3g"
        case .slow4G: "slow-4g"
        case .fast4G: "fast-4g"
        case .offline: "offline"
        case .custom: "custom"
        }
        var arguments = ["--network-profile", profile]
        if bandwidthConfiguration.profile == .custom {
            if let latency = bandwidthConfiguration.latencyMs {
                arguments += ["--latency-ms", String(latency)]
            }
            if let upload = bandwidthConfiguration.uploadBytesPerSecond {
                arguments += ["--upload-bps", String(upload)]
            }
            if let download = bandwidthConfiguration.downloadBytesPerSecond {
                arguments += ["--download-bps", String(download)]
            }
        }
        return arguments
    }

    private func cleanupPrivateRoutingConfiguration() {
        try? removePrivateRoutingConfiguration()
    }

    private func removePrivateRoutingConfiguration() throws {
        guard let url = privateRoutingConfigurationURL else { return }
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        privateRoutingConfigurationURL = nil
    }

    private static func findNode() -> String {
        ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/opt/homebrew/bin/node"
    }

    private static func findCLI() -> String {
        var directory = Bundle.main.bundleURL.deletingLastPathComponent()
        for _ in 0 ..< 5 {
            let candidate = directory.appendingPathComponent("packages/hakka-cli/dist/cli.mjs").path
            if FileManager.default.fileExists(atPath: candidate) {
                return candidate
            }
            directory.deleteLastPathComponent()
        }
        return ["/opt/homebrew/bin/hakka", "/usr/local/bin/hakka"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? ""
    }
}
