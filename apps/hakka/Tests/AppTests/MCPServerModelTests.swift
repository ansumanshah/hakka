import Testing
@testable import HakkaApp

/// `MCPServerModel`'s lifecycle bookkeeping (`isRunning`/`boundPort`/
/// `startupError`) exercised against `FakeMCPServerControlling` rather than
/// a real `MCPServer` — forcing a real `NWListener` bind to fail on demand
/// isn't reproducible, while a fake's `start()` throwing is.
@Suite("MCPServerModel lifecycle")
@MainActor
struct MCPServerModelTests {
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

/// `@unchecked Sendable`: this fake is only ever touched from the
/// `@MainActor` test suite above, the same single-context rationale
/// `MCPHTTPConnection` documents for its own `@unchecked Sendable` — the
/// compiler cannot see that guarantee, but there is nothing here for it to
/// disprove either.
private final class FakeMCPServerControlling: MCPServerControlling, @unchecked Sendable {
    var startResult: Result<UInt16, Error> = .success(9001)
    private(set) var stopCallCount = 0

    func start() async throws -> UInt16 {
        try startResult.get()
    }

    func stop() async {
        stopCallCount += 1
    }
}
