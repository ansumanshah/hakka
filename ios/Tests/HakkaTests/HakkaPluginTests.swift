import Foundation
import Testing
@testable import HakkaNetwork
import HakkaCommon

// MARK: - Helpers

private func makeRequest(id: String, status: Int? = 200) -> NetworkRequest {
    NetworkRequest(
        id: id,
        url: "https://api.example.com/\(id)",
        method: .get,
        status: status,
        startTime: Int64(Date().timeIntervalSince1970 * 1000),
        duration: 42,
        source: .urlSession
    )
}

// MARK: - Stub plugin

private final class StubPlugin: HakkaPlugin, @unchecked Sendable {
    let id: String
    let panels: [HakkaPanel]
    var setupCallCount = 0

    init(id: String = "stub", panels: [HakkaPanel] = []) {
        self.id = id
        self.panels = panels
    }

    func setup(ctx: any HakkaPluginContext) {
        setupCallCount += 1
    }
}

// MARK: - HakkaPluginRegistry unit tests

@Suite("PluginRegistry")
struct PluginRegistryTests {

    // MARK: Registration

    @Test func registerPluginCallsSetup() {
        let interceptor = HakkaInterceptor()
        let plugin = StubPlugin()
        interceptor.use(plugin)
        #expect(plugin.setupCallCount == 1)
    }

    @Test func duplicateIdIsIgnored() {
        let interceptor = HakkaInterceptor()
        let a = StubPlugin(id: "dup")
        let b = StubPlugin(id: "dup")
        let r1 = interceptor.use(a)
        let r2 = interceptor.use(b)
        #expect(r1 == true)
        #expect(r2 == false)
        #expect(a.setupCallCount == 1)
        #expect(b.setupCallCount == 0) // never called — duplicate
        #expect(interceptor.pluginRegistry.plugins.count == 1)
    }

    @Test func differentIdsAreRegisteredIndependently() {
        let interceptor = HakkaInterceptor()
        interceptor.use(StubPlugin(id: "alpha"))
        interceptor.use(StubPlugin(id: "beta"))
        #expect(interceptor.pluginRegistry.plugins.count == 2)
    }

    @Test func pluginsReturnedInRegistrationOrder() {
        let interceptor = HakkaInterceptor()
        interceptor.use(StubPlugin(id: "first"))
        interceptor.use(StubPlugin(id: "second"))
        interceptor.use(StubPlugin(id: "third"))
        let ids = interceptor.pluginRegistry.plugins.map(\.id)
        #expect(ids == ["first", "second", "third"])
    }

    // MARK: Panels

    @Test func panelsFromSinglePlugin() {
        let interceptor = HakkaInterceptor()
        let plugin = StubPlugin(id: "p", panels: [
            HakkaPanel(id: "my-panel", title: "My Panel", order: 10)
        ])
        interceptor.use(plugin)
        #expect(interceptor.pluginRegistry.panels.count == 1)
        #expect(interceptor.pluginRegistry.panels[0].id == "my-panel")
    }

    @Test func panelsOrderedByOrderThenRegistration() {
        let interceptor = HakkaInterceptor()
        let a = StubPlugin(id: "a", panels: [
            HakkaPanel(id: "a-low", title: "A Low", order: 50),
            HakkaPanel(id: "a-high", title: "A High", order: 10),
        ])
        let b = StubPlugin(id: "b", panels: [
            HakkaPanel(id: "b-mid", title: "B Mid", order: 30),
        ])
        interceptor.use(a)
        interceptor.use(b)
        let ids = interceptor.pluginRegistry.panels.map(\.id)
        // order 10 < 30 < 50
        #expect(ids == ["a-high", "b-mid", "a-low"])
    }

    @Test func noPanelsWhenNoPluginsRegistered() {
        let interceptor = HakkaInterceptor()
        #expect(interceptor.pluginRegistry.panels.isEmpty)
    }

    // MARK: Context — getLogs

    @Test func contextGetLogsReflectsStore() {
        let interceptor = HakkaInterceptor()

        final class LogsPlugin: HakkaPlugin, @unchecked Sendable {
            let id = "ctx-logs-2"
            var ctx: (any HakkaPluginContext)?
            func setup(ctx: any HakkaPluginContext) { self.ctx = ctx }
        }

        let p = LogsPlugin()
        interceptor.use(p)
        interceptor.store.add(makeRequest(id: "r1"))
        interceptor.store.add(makeRequest(id: "r2"))
        let logs = p.ctx?.getLogs() ?? []
        #expect(logs.count == 2)
    }

    // MARK: Context — onRequest

    @Test func contextOnRequestFiresOnCommit() async {
        let interceptor = HakkaInterceptor()
        var received: [NetworkRequest] = []

        final class ListenerPlugin: HakkaPlugin, @unchecked Sendable {
            let id = "listener"
            var sub: HakkaPluginSubscription?
            var onReceive: ((NetworkRequest) -> Void)?

            func setup(ctx: any HakkaPluginContext) {
                sub = ctx.onRequest { req in
                    self.onReceive?(req)
                }
            }
        }

        let p = ListenerPlugin()
        p.onReceive = { received.append($0) }
        interceptor.use(p)
        interceptor.commitProcessedCapture(makeRequest(id: "evt1"))
        interceptor.commitProcessedCapture(makeRequest(id: "evt2"))
        interceptor.flushCaptureProcessing()
        // Small settle for the async fan-out queue
        try? await Task.sleep(nanoseconds: 10_000_000)
        #expect(received.count == 2)
        #expect(received.map(\.id) == ["evt1", "evt2"])
    }

    // MARK: Context — ingest

    @Test func contextIngestAddsToStore() {
        let interceptor = HakkaInterceptor()

        final class IngestPlugin: HakkaPlugin, @unchecked Sendable {
            let id = "ingest"
            var ctx: (any HakkaPluginContext)?
            func setup(ctx: any HakkaPluginContext) { self.ctx = ctx }
        }

        let p = IngestPlugin()
        interceptor.use(p)
        p.ctx?.ingest(makeRequest(id: "injected"))
        #expect(interceptor.store.count == 1)
        #expect(interceptor.store.request(byId: "injected") != nil)
    }

    // MARK: Context — registerSink

    @Test func contextRegisterSinkReceivesRecords() async {
        let interceptor = HakkaInterceptor()
        var sinkRecords: [any ContractRecord] = []

        final class SinkPlugin: HakkaPlugin, @unchecked Sendable {
            let id = "sink"
            var sub: HakkaPluginSubscription?
            var onRecord: ((any ContractRecord) -> Void)?

            func setup(ctx: any HakkaPluginContext) {
                sub = ctx.registerSink { record in
                    self.onRecord?(record)
                }
            }
        }

        let p = SinkPlugin()
        p.onRecord = { sinkRecords.append($0) }
        interceptor.use(p)
        interceptor.commitProcessedCapture(makeRequest(id: "sink-r1"))
        interceptor.flushSinks()
        #expect(sinkRecords.count == 1)
    }

    // MARK: LogStore — update

    @Test func logStoreUpdateMutatesExistingEntry() {
        let store = LogStore(capacity: 10)
        store.add(makeRequest(id: "u1", status: 200))
        let updated = store.update(id: "u1") { $0 = NetworkRequest(
            id: $0.id,
            url: $0.url,
            method: $0.method,
            status: 204,
            startTime: $0.startTime,
            duration: $0.duration,
            source: $0.source
        )}
        #expect(updated == true)
        #expect(store.request(byId: "u1")?.status == 204)
    }

    @Test func logStoreUpdateReturnsFalseForMissingId() {
        let store = LogStore(capacity: 10)
        let updated = store.update(id: "missing") { _ in }
        #expect(updated == false)
    }
}
