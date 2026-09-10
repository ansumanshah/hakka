import Foundation
@testable import HakkaApp
import Testing

@Suite("System proxy routing")
struct SystemProxyRoutingTests {
    @Test func appliesBothProtocolsAndRestoresSnapshot() async throws {
        let transport = FakeNetworkSetup()
        let journal = temporaryJournal()
        let router = SystemProxyRouter(transport: transport, journalURL: journal)
        try await router.apply(port: 8181)
        #expect(await transport.endpoint("Wi-Fi", secure: false).host == "127.0.0.1")
        #expect(await transport.endpoint("Wi-Fi", secure: true).port == 8181)
        #expect(FileManager.default.fileExists(atPath: journal.path))
        #expect(await router.restore() == nil)
        #expect(await transport.endpoint("Wi-Fi", secure: false).host == "proxy.example")
        #expect(await transport.endpoint("Wi-Fi", secure: true).enabled == false)
        #expect(!FileManager.default.fileExists(atPath: journal.path))
    }

    @Test func partialApplyIsRolledBack() async throws {
        let transport = FakeNetworkSetup(failing: "-setsecurewebproxy")
        let journal = temporaryJournal()
        let router = SystemProxyRouter(transport: transport, journalURL: journal)
        await #expect(throws: SystemProxyRoutingError.self) { try await router.apply(port: 8181) }
        #expect(await transport.endpoint("Wi-Fi", secure: false).host == "proxy.example")
        #expect(!FileManager.default.fileExists(atPath: journal.path))
    }

    @Test func changedUserSettingsAreNotOverwritten() async throws {
        let transport = FakeNetworkSetup()
        let router = SystemProxyRouter(transport: transport, journalURL: temporaryJournal())
        try await router.apply(port: 8181)
        await transport.setUserEndpoint("Wi-Fi", secure: false, endpoint: .init(enabled: true, host: "user.example", port: 8080, authenticationEnabled: false))
        _ = await router.restore()
        #expect(await transport.endpoint("Wi-Fi", secure: false).host == "user.example")
        // HTTPS was still owned by Hakka and must not be stranded when HTTP changed.
        #expect(await transport.endpoint("Wi-Fi", secure: true).host == "secure.example")
    }

    @Test func nextLaunchRecoversOnlyOwnedStaleRoute() async throws {
        let transport = FakeNetworkSetup()
        let journal = temporaryJournal()
        let first = SystemProxyRouter(transport: transport, journalURL: journal)
        try await first.apply(port: 8181)
        let recovered = SystemProxyRouter(transport: transport, journalURL: journal)
        #expect(await recovered.hasPendingRecovery())
        #expect(await recovered.recover() == nil)
        #expect(await transport.endpoint("Wi-Fi", secure: false).host == "proxy.example")
    }

    @Test func crashDuringPartialApplyDoesNotOverwriteLaterUserChange() async throws {
        let transport = FakeNetworkSetup()
        let journalURL = temporaryJournal()
        let originalHTTP = await transport.endpoint("Wi-Fi", secure: false)
        let originalHTTPS = await transport.endpoint("Wi-Fi", secure: true)
        let partial = SystemProxyJournal(
            port: 8181,
            services: [.init(service: "Wi-Fi", http: originalHTTP, https: originalHTTPS)],
            expected: ["Wi-Fi": .init(
                http: .init(enabled: true, host: "127.0.0.1", port: 8181, authenticationEnabled: false),
                https: originalHTTPS
            )],
            pending: [:]
        )
        try JSONEncoder().encode(partial).write(to: journalURL, options: .atomic)
        await transport.setUserEndpoint("Wi-Fi", secure: false, endpoint: .init(enabled: true, host: "user.example", port: 8080, authenticationEnabled: false))
        let router = SystemProxyRouter(transport: transport, journalURL: journalURL)
        _ = await router.recover()
        #expect(await transport.endpoint("Wi-Fi", secure: false).host == "user.example")
        #expect(await transport.endpoint("Wi-Fi", secure: true) == originalHTTPS)
    }

    @Test func crashAfterStagedApplyRestoresOnlyTheRecordedTransition() async throws {
        let transport = FakeNetworkSetup()
        let journalURL = temporaryJournal()
        let originalHTTP = await transport.endpoint("Wi-Fi", secure: false)
        let originalHTTPS = await transport.endpoint("Wi-Fi", secure: true)
        let stagedHTTP = SystemProxyEndpoint(enabled: originalHTTP.enabled, host: "127.0.0.1", port: 8181, authenticationEnabled: false)
        let journal = SystemProxyJournal(
            port: 8181,
            services: [.init(service: "Wi-Fi", http: originalHTTP, https: originalHTTPS)],
            expected: ["Wi-Fi": .init(http: originalHTTP, https: originalHTTPS)],
            pending: ["Wi-Fi": .init(http: stagedHTTP, https: originalHTTPS)]
        )
        try JSONEncoder().encode(journal).write(to: journalURL, options: .atomic)
        await transport.setUserEndpoint("Wi-Fi", secure: false, endpoint: stagedHTTP)
        let router = SystemProxyRouter(transport: transport, journalURL: journalURL)
        #expect(await router.recover() == nil)
        #expect(await transport.endpoint("Wi-Fi", secure: false) == originalHTTP)
    }

    @Test func crashDuringRestoreFinishesTheRecordedInverseTransition() async throws {
        let transport = FakeNetworkSetup()
        let journalURL = temporaryJournal()
        let originalHTTP = await transport.endpoint("Wi-Fi", secure: false)
        let originalHTTPS = await transport.endpoint("Wi-Fi", secure: true)
        let routedHTTPS = SystemProxyEndpoint(enabled: true, host: "127.0.0.1", port: 8181, authenticationEnabled: false)
        let halfRestoredHTTPS = SystemProxyEndpoint(enabled: true, host: originalHTTPS.host, port: originalHTTPS.port, authenticationEnabled: false)
        let journal = SystemProxyJournal(
            port: 8181,
            services: [.init(service: "Wi-Fi", http: originalHTTP, https: originalHTTPS)],
            expected: ["Wi-Fi": .init(http: originalHTTP, https: routedHTTPS)],
            pending: ["Wi-Fi": .init(http: originalHTTP, https: halfRestoredHTTPS)]
        )
        try JSONEncoder().encode(journal).write(to: journalURL, options: .atomic)
        await transport.setUserEndpoint("Wi-Fi", secure: true, endpoint: halfRestoredHTTPS)
        let router = SystemProxyRouter(transport: transport, journalURL: journalURL)
        #expect(await router.recover() == nil)
        #expect(await transport.endpoint("Wi-Fi", secure: true) == originalHTTPS)
    }

    @Test func queuedRestoreWaitsForApplyThenReturnsOriginalSettings() async throws {
        let transport = FakeNetworkSetup(holding: "-setwebproxystate")
        let journal = temporaryJournal()
        let router = SystemProxyRouter(transport: transport, journalURL: journal)
        let apply = Task { try await router.apply(port: 8181) }
        await transport.waitUntilHeld()
        let restore = Task { await router.restore() }
        await transport.releaseHeldCommand()
        try await apply.value
        #expect(await restore.value == nil)
        #expect(await transport.endpoint("Wi-Fi", secure: false).host == "proxy.example")
        #expect(await transport.endpoint("Wi-Fi", secure: true).enabled == false)
        #expect(!FileManager.default.fileExists(atPath: journal.path))
    }

    @Test func failedRecoveryKeepsOriginalJournalForRetry() async throws {
        let transport = FakeNetworkSetup(failing: "-setwebproxy", failingTimes: 1)
        let journalURL = temporaryJournal()
        let originalHTTP = await transport.endpoint("Wi-Fi", secure: false)
        let originalHTTPS = await transport.endpoint("Wi-Fi", secure: true)
        let routed = SystemProxyEndpoint(enabled: true, host: "127.0.0.1", port: 8181, authenticationEnabled: false)
        let journal = SystemProxyJournal(
            port: 8181,
            services: [.init(service: "Wi-Fi", http: originalHTTP, https: originalHTTPS)],
            expected: ["Wi-Fi": .init(http: routed, https: routed)],
            pending: [:]
        )
        try JSONEncoder().encode(journal).write(to: journalURL, options: .atomic)
        await transport.setUserEndpoint("Wi-Fi", secure: false, endpoint: routed)
        await transport.setUserEndpoint("Wi-Fi", secure: true, endpoint: routed)
        let router = SystemProxyRouter(transport: transport, journalURL: journalURL)
        #expect(await router.recover() != nil)
        #expect(FileManager.default.fileExists(atPath: journalURL.path))
        #expect(await router.recover() == nil)
        #expect(await transport.endpoint("Wi-Fi", secure: false) == originalHTTP)
        #expect(!FileManager.default.fileExists(atPath: journalURL.path))
    }

    @Test func rejectsAuthenticatedProxyBeforeMutation() async throws {
        let transport = FakeNetworkSetup(authenticated: true)
        let journal = temporaryJournal()
        let router = SystemProxyRouter(transport: transport, journalURL: journal)
        await #expect(throws: SystemProxyRoutingError.self) { try await router.apply(port: 8181) }
        #expect(await transport.commands().allSatisfy { !$0.contains("-set") })
        #expect(!FileManager.default.fileExists(atPath: journal.path))
    }

    @Test func corruptJournalBlocksNewApplyWithoutNetworkMutation() async throws {
        let transport = FakeNetworkSetup()
        let journal = temporaryJournal()
        try Data("not a journal".utf8).write(to: journal, options: .atomic)
        let router = SystemProxyRouter(transport: transport, journalURL: journal)
        await #expect(throws: SystemProxyRoutingError.self) { try await router.apply(port: 8181) }
        #expect(await transport.commands().isEmpty)
        #expect(await router.recover()?.contains("cannot be read") == true)
        #expect(FileManager.default.fileExists(atPath: journal.path))
    }

    private func temporaryJournal() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("hakka-proxy-\(UUID().uuidString).json")
    }
}

private actor FakeNetworkSetup: SystemProxyCommandTransport {
    private struct Service { var http: SystemProxyEndpoint; var https: SystemProxyEndpoint }
    private var services: [String: Service]
    private var recorded: [[String]] = []
    private let failing: String?
    private var failuresRemaining: Int
    private let holding: String?
    private var didHold = false
    private var heldWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    init(failing: String? = nil, failingTimes: Int = .max, holding: String? = nil, authenticated: Bool = false) {
        self.failing = failing
        failuresRemaining = failingTimes
        self.holding = holding
        services = ["Wi-Fi": Service(
            http: .init(enabled: true, host: "proxy.example", port: 3128, authenticationEnabled: authenticated),
            https: .init(enabled: false, host: "secure.example", port: 444, authenticationEnabled: false)
        )]
    }

    func run(arguments: [String]) async throws -> SystemProxyCommandResult {
        recorded.append(arguments)
        if arguments.first == holding, !didHold {
            didHold = true
            heldWaiters.forEach { $0.resume() }
            heldWaiters.removeAll()
            await withCheckedContinuation { releaseContinuation = $0 }
        }
        if arguments.first == failing, failuresRemaining > 0 {
            failuresRemaining -= 1
            throw SystemProxyCommandError.failed(1, "denied")
        }
        switch arguments.first {
        case "-listallnetworkservices": return .init(stdout: "An asterisk (*) denotes that a network service is disabled.\nWi-Fi\n", stderr: "")
        case "-getwebproxy": return .init(stdout: output(services[arguments[1]]!.http), stderr: "")
        case "-getsecurewebproxy": return .init(stdout: output(services[arguments[1]]!.https), stderr: "")
        case "-setwebproxy": update(arguments[1], secure: false) { $0.host = arguments[2]; $0.port = Int(arguments[3])! }
        case "-setsecurewebproxy": update(arguments[1], secure: true) { $0.host = arguments[2]; $0.port = Int(arguments[3])! }
        case "-setwebproxystate": update(arguments[1], secure: false) { $0.enabled = arguments[2] == "on" }
        case "-setsecurewebproxystate": update(arguments[1], secure: true) { $0.enabled = arguments[2] == "on" }
        default: Issue.record("Unexpected command: \(arguments)")
        }
        return .init(stdout: "", stderr: "")
    }

    func endpoint(_ service: String, secure: Bool) -> SystemProxyEndpoint {
        secure ? services[service]!.https : services[service]!.http
    }

    func setUserEndpoint(_ service: String, secure: Bool, endpoint: SystemProxyEndpoint) {
        update(service, secure: secure) { $0 = endpoint }
    }

    func commands() -> [[String]] {
        recorded
    }

    func waitUntilHeld() async {
        if didHold {
            return
        }
        await withCheckedContinuation { heldWaiters.append($0) }
    }

    func releaseHeldCommand() {
        releaseContinuation?.resume(); releaseContinuation = nil
    }

    private func update(_ service: String, secure: Bool, _ mutate: (inout SystemProxyEndpoint) -> Void) {
        var value = services[service]!
        if secure {
            mutate(&value.https)
        } else {
            mutate(&value.http)
        }
        services[service] = value
    }

    private func output(_ endpoint: SystemProxyEndpoint) -> String {
        "Enabled: \(endpoint.enabled ? "Yes" : "No")\nServer: \(endpoint.host)\nPort: \(endpoint.port)\nAuthenticated Proxy Enabled: \(endpoint.authenticationEnabled ? "Yes" : "No")\n"
    }
}
