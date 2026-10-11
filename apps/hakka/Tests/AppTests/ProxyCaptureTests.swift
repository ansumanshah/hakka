import Foundation
@testable import HakkaApp
import HakkaServer
import Observation
import Synchronization
import Testing

@Suite("Native proxy capture")
struct ProxyCaptureTests {
    @Test @MainActor func invalidExplicitEnginePathDoesNotLaunch() throws {
        let proxy = ProxyCaptureModel(defaults: try #require(UserDefaults(suiteName: UUID().uuidString)))
        proxy.cliPath = "/usr/bin/true"
        proxy.mitmdumpPath = "/does-not-exist/hakka-fixture-mitmdump"
        proxy.start()
        #expect(proxy.state == .failed)
        #expect(!proxy.isActive)
        #expect(proxy.lastError?.contains("executable mitmdump") == true)
    }

    @Test @MainActor func failedCaptureBecomesObservableAsInactiveAfterChildExit() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let release = directory.appendingPathComponent("release")
        let script = directory.appendingPathComponent("fake-cli")
        try Data("#!/bin/sh\nprintf '{\"status\":\"error\",\"message\":\"Startup failed\"}\\n'\nwhile [ ! -e '\(release.path)' ]; do /bin/sleep 0.05; done\n".utf8).write(to: script)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        let proxy = try ProxyCaptureModel(defaults: #require(UserDefaults(suiteName: UUID().uuidString)), directory: directory)
        proxy.cliPath = script.path
        defer { try? Data().write(to: release) }
        proxy.start()
        for _ in 0 ..< 100 where proxy.state != .failed {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(proxy.state == .failed)
        #expect(proxy.isActive)
        let changed = Mutex(false)
        withObservationTracking {
            _ = proxy.isActive
        } onChange: {
            changed.withLock { $0 = true }
        }
        try Data().write(to: release)
        for _ in 0 ..< 100 where proxy.isActive {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(!proxy.isActive)
        #expect(changed.withLock { $0 })
        #expect(proxy.state == .failed)
        #expect(proxy.lastError == "Startup failed")
    }

    @Test @MainActor func malformedChildOutputRemainsAFailureAfterCleanup() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let script = directory.appendingPathComponent("fake-cli")
        try Data("#!/bin/sh\nprintf 'invalid-status\\n'\nexec /bin/sleep 30\n".utf8).write(to: script)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        let proxy = ProxyCaptureModel(defaults: try #require(UserDefaults(suiteName: UUID().uuidString)), directory: directory)
        proxy.cliPath = script.path
        proxy.start()
        for _ in 0..<100 where proxy.state != .failed { try await Task.sleep(for: .milliseconds(50)) }
        #expect(proxy.state == .failed)
        #expect(!proxy.isActive)
        #expect(proxy.lastError == "The proxy returned an invalid status message.")
    }

    @Test @MainActor func shutdownConfirmsExitOfATermResistantChild() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let script = directory.appendingPathComponent("fake-cli")
        try Data("#!/usr/bin/python3\nimport signal,time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\nprint('{\"status\":\"started\"}', flush=True)\ntime.sleep(30)\n".utf8).write(to: script)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        let proxy = ProxyCaptureModel(defaults: try #require(UserDefaults(suiteName: UUID().uuidString)), directory: directory)
        proxy.cliPath = script.path
        proxy.start()
        for _ in 0..<100 where proxy.state == .starting { try await Task.sleep(for: .milliseconds(20)) }
        #expect(proxy.state == .running)
        #expect(await proxy.shutdown())
        #expect(!proxy.isActive)
        #expect(proxy.state == .stopped)
    }

    @Test @MainActor func bandwidthArgumentsUseCanonicalProfilesAndCustomLimits() throws {
        let model = ProxyCaptureModel(defaults: try #require(UserDefaults(suiteName: UUID().uuidString)))
        model.bandwidthConfiguration = ProxyBandwidthConfiguration(profile: .fast3G)
        #expect(model.bandwidthArguments() == ["--network-profile", "fast-3g"])
        model.bandwidthConfiguration = ProxyBandwidthConfiguration(
            profile: .custom,
            latencyMs: 25,
            uploadBytesPerSecond: 1024,
            downloadBytesPerSecond: 2048,
        )
        #expect(model.bandwidthArguments() == [
            "--network-profile", "custom",
            "--latency-ms", "25",
            "--upload-bps", "1024",
            "--download-bps", "2048",
        ])
    }

    @Test @MainActor func breakpointReadinessResynchronizesOnlyAnActiveSession() async throws {
        let model = ProxyCaptureModel(defaults: try #require(UserDefaults(suiteName: UUID().uuidString)))
        var synchronizations = 0
        model.onBreakpointReady = { synchronizations += 1 }
        let ready = try JSONDecoder().decode(ProxyStatusLine.self, from: Data(#"{"status":"breakpoint-ready"}"#.utf8))
        model.consume(.status(ready))
        await Task.yield()
        #expect(synchronizations == 0)
        let started = try JSONDecoder().decode(ProxyStatusLine.self, from: Data(#"{"status":"started"}"#.utf8))
        model.consume(.status(started))
        model.consume(.status(ready))
        for _ in 0..<100 where synchronizations == 0 { await Task.yield() }
        #expect(synchronizations == 1)
        model.consume(.exited(0))
        model.consume(.status(ready))
        await Task.yield()
        #expect(synchronizations == 1)
    }

    @Test @MainActor func agentControlRequiresWindowOptIn() async throws {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        let proxy = ProxyCaptureModel(defaults: defaults)
        let tools = NativeProxyTool.tools(proxy: proxy, traffic: TrafficModel())
        let start = try #require(tools.first { $0.name == "proxy_start" })
        let denied = await start.call(.object([:]))
        #expect(denied.isError)
        #expect(proxy.state == .stopped)
        proxy.allowAgentControl = true
        let unavailableBridge = await start.call(.object([:]))
        #expect(unavailableBridge.isError)
        #expect(proxy.state == .stopped)
        let status = try #require(tools.first { $0.name == "proxy_status" })
        #expect(await status.call(.object([:])).isError == false)
    }

    @Test func processReportsReadinessWhileChildIsStillRunning() async throws {
        let (process, events) = try ProxyProcessStream.launch(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", #"printf '%s\n' '{"status":"started"}'; exec /bin/sleep 30"#]
        )
        // A fail-safe for a broken stream implementation, not the expected
        // completion path. Leave enough headroom for a cold, loaded CI executor
        // to consume the immediate status before this deliberately kills the child.
        let timeout = Task {
            try? await Task.sleep(for: .seconds(10))
            if process.isRunning { process.terminate() }
        }
        defer { timeout.cancel() }
        var reportedWhileRunning = false
        for await event in events {
            if case let .status(status) = event, status.status == "started" {
                reportedWhileRunning = process.isRunning
                if process.isRunning { process.terminate() }
            }
        }
        #expect(reportedWhileRunning)
    }

    @Test func processDrainsFinalStatusBeforeExit() async throws {
        let (_, events) = try ProxyProcessStream.launch(
            executable: URL(fileURLWithPath: "/usr/bin/printf"),
            arguments: ["%s\\n%s", #"{"status":"started","port":8080}"#, #"{"status":"stopped","records":3}"#],
        )
        var statuses: [String] = []
        var exit: Int32?
        for await event in events {
            switch event {
            case let .status(status): statuses.append(status.status)
            case let .exited(code): exit = code
            case let .failure(reason): Issue.record("\(reason)")
            }
        }
        #expect(statuses == ["started", "stopped"])
        #expect(exit == 0)
    }

    @Test func malformedStatusFailsWithoutClaimingCaptureStarted() async throws {
        let (_, events) = try ProxyProcessStream.launch(executable: URL(fileURLWithPath: "/usr/bin/printf"), arguments: ["not-json\\n"])
        var failures = 0
        for await event in events {
            if case .failure = event { failures += 1 }
            if case .status = event { Issue.record("Malformed output became a status") }
        }
        #expect(failures == 1)
    }

    @Test @MainActor func validationDoesNotLaunchAndRestartClearsCertificate() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        let model = ProxyCaptureModel(defaults: defaults, directory: directory)
        model.port = 0
        model.start()
        #expect(model.state == .failed)
        #expect(model.lastError == "Choose a port between 1 and 65535.")
        #expect(!model.isActive)
        let status = try JSONDecoder().decode(ProxyStatusLine.self, from: Data(#"{"status":"started","certificates":{"configDir":"/tmp","publicCaPath":"/tmp/public.pem","publicCaExists":true}}"#.utf8))
        model.consume(.status(status))
        #expect(model.certificatePath == "/tmp/public.pem")
        model.consume(.exited(0))
        model.start()
        #expect(model.certificatePath == nil)
    }

    @Test func mappingsRoundTripAndRejectDirectories() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let response = directory.appendingPathComponent("response.json")
        try Data("{}".utf8).write(to: response)
        let output = directory.appendingPathComponent("mappings.json")
        var mappings = ProxyMappingFile(mapLocal: [ProxyLocalMapping(match: "/api", file: response.path)])
        try mappings.write(to: output)
        let saved = try JSONDecoder().decode(ProxyMappingFile.self, from: Data(contentsOf: output))
        #expect(saved.mapLocal.first?.file == response.path)
        mappings.mapLocal[0].file = directory.path
        #expect(throws: (any Error).self) { try mappings.write(to: output) }
        #expect(try JSONDecoder().decode(ProxyMappingFile.self, from: Data(contentsOf: output)).mapLocal.first?.file == response.path)
    }
}
