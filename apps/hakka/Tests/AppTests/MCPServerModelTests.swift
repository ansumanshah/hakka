import Foundation
@testable import HakkaApp
import Testing

/// `MCPServerModel`'s lifecycle bookkeeping (`isRunning`/`boundPort`/
/// `startupError`) exercised against `FakeMCPServerControlling` rather than
/// a real `MCPServer` — forcing a real `NWListener` bind to fail on demand
/// isn't reproducible, while a fake's `start()` throwing is.
@Suite("MCPServerModel lifecycle")
@MainActor
struct MCPServerModelTests {
    @Test func concurrentStartsShareOneLifecycleTransition() async {
        let fake = FakeMCPServerControlling()
        fake.suspendStart = true
        let model = MCPServerModel(server: fake)
        let first = Task { await model.start() }
        while fake.startContinuation == nil {
            await Task.yield()
        }

        #expect(model.isStarting)
        await model.start()
        #expect(fake.startCallCount == 1)
        fake.startContinuation?.resume(returning: 9003)
        await first.value
        #expect(model.boundPort == 9003)
        #expect(!model.isChangingState)
    }

    @Test func stoppedPendingStartCannotRestoreRunningState() async {
        let fake = FakeMCPServerControlling()
        fake.suspendStart = true
        let model = MCPServerModel(server: fake)
        let pending = Task { await model.start() }
        while fake.startContinuation == nil {
            await Task.yield()
        }

        await model.stop()
        fake.startContinuation?.resume(returning: 9003)
        await pending.value

        #expect(!model.isRunning)
        #expect(model.boundPort == nil)
        #expect(!model.isChangingState)
    }

    @Test func copiedConfigurationContainsTheBoundEndpoint() throws {
        let data = Data(MCPSettingsSection.configuration(port: 9003).utf8)
        let root = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let servers = try #require(root["mcpServers"] as? [String: Any])
        let desktop = try #require(servers["hakka-desktop"] as? [String: Any])
        #expect(desktop["url"] as? String == "http://127.0.0.1:9003")
    }

    @Test func startSetsRunningAndTheResolvedPort() async {
        let fake = FakeMCPServerControlling()
        fake.startResult = .success(9001)
        let model = MCPServerModel(server: fake)

        await model.start()

        #expect(model.isRunning)
        #expect(model.boundPort == 9001)
        #expect(model.startupError == nil)
    }

    @Test func stopClearsRunningAndBoundPort() async {
        let fake = FakeMCPServerControlling()
        fake.startResult = .success(9001)
        let model = MCPServerModel(server: fake)
        await model.start()

        await model.stop()

        #expect(!model.isRunning)
        #expect(model.boundPort == nil)
        #expect(fake.stopCallCount == 1)
    }

    @Test func aFailedStartSurfacesAnErrorRatherThanAppearingToSucceed() async {
        let fake = FakeMCPServerControlling()
        fake.startResult = .failure(FakeMCPServerError.boom)
        let model = MCPServerModel(server: fake)

        await model.start()

        #expect(!model.isRunning)
        #expect(model.boundPort == nil)
        #expect(model.startupError != nil)
    }

    /// A retry after a failure clears the stale error rather than leaving
    /// both an error message and a "running" state visible at once.
    @Test func aSuccessfulRetryClearsThePriorStartupError() async {
        let fake = FakeMCPServerControlling()
        fake.startResult = .failure(FakeMCPServerError.boom)
        let model = MCPServerModel(server: fake)
        await model.start()
        #expect(model.startupError != nil)

        fake.startResult = .success(9002)
        await model.start()

        #expect(model.isRunning)
        #expect(model.boundPort == 9002)
        #expect(model.startupError == nil)
    }
}

private enum FakeMCPServerError: Error {
    case boom
}

/// Keeps controlled start suspension and lifecycle assertions on the same actor.
@MainActor
private final class FakeMCPServerControlling: MCPServerControlling {
    var startResult: Result<UInt16, Error> = .success(9001)
    private(set) var stopCallCount = 0
    private(set) var startCallCount = 0
    var suspendStart = false
    var startContinuation: CheckedContinuation<UInt16, Error>?

    func start() async throws -> UInt16 {
        startCallCount += 1
        if suspendStart {
            return try await withCheckedThrowingContinuation { startContinuation = $0 }
        }
        return try startResult.get()
    }

    func stop() async {
        stopCallCount += 1
    }
}
