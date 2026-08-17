import Foundation
import Testing
@testable import HakkaNetwork
import HakkaCommon

@Suite struct RecordSinkTests {
    @Test func sinksReceiveRecordsAfterStoreMutation() throws {
        let interceptor = HakkaInterceptor(config: HakkaConfig(maxRequests: 10))
        let records = RecordBox()
        let subscription = interceptor.addSink { record in
            records.append(try #require(record as? NetworkRecord))
        }

        interceptor.didCapture(request(id: "request-1"))
        interceptor.flushCaptureProcessing()
        interceptor.flushSinks()

        let delivered = records.values()
        #expect(interceptor.store.request(byId: "request-1") != nil)
        #expect(delivered.map(\.id) == ["request-1"])
        #expect(delivered.first?.request.id == "request-1")
        subscription.cancel()
    }

    @Test func sinkFailuresDoNotBlockOtherSinks() throws {
        let interceptor = HakkaInterceptor(config: HakkaConfig(maxRequests: 10))
        let records = RecordBox()
        let failingSubscription = interceptor.addSink { _ in throw SinkError.expected }
        let receivingSubscription = interceptor.addSink { record in
            records.append(try #require(record as? NetworkRecord))
        }

        interceptor.didCapture(request(id: "request-1"))
        interceptor.flushCaptureProcessing()
        interceptor.flushSinks()

        #expect(records.values().map(\.id) == ["request-1"])
        failingSubscription.cancel()
        receivingSubscription.cancel()
    }

    @Test func cancelledSubscriptionStopsDelivery() throws {
        let interceptor = HakkaInterceptor(config: HakkaConfig(maxRequests: 10))
        let records = RecordBox()
        let subscription = interceptor.addSink { record in
            records.append(try #require(record as? NetworkRecord))
        }

        interceptor.didCapture(request(id: "request-1"))
        interceptor.flushCaptureProcessing()
        interceptor.flushSinks()
        subscription.cancel()
        interceptor.didCapture(request(id: "request-2"))
        interceptor.flushCaptureProcessing()
        interceptor.flushSinks()

        #expect(records.values().map(\.id) == ["request-1"])
    }

    @Test func sinkHubDropsRecordsWhenPendingDeliveryIsFull() {
        let hub = RecordSinkHub(maxPending: 1)
        let gate = SinkGate()
        let subscription = hub.add { _ in
            gate.enter()
            gate.waitForRelease()
        }

        hub.emit(NetworkRecord.from(request(id: "request-1"), id: "request-1", timestamp: 1_000))
        #expect(gate.waitForEntry())

        for index in 0..<20 {
            hub.emit(NetworkRecord.from(request(id: "request-drop-\(index)"), id: "request-drop-\(index)", timestamp: 1_000))
        }

        #expect(hub.droppedCount() > 0)
        gate.release()
        #expect(hub.flush(timeout: 2))
        subscription.cancel()
    }

    @Test func injectedBreadcrumbsAndTracesReachSinks() throws {
        let interceptor = HakkaInterceptor(config: HakkaConfig(maxRequests: 10))
        let collected = ContractRecordBox()
        let subscription = interceptor.addSink { collected.append($0) }

        interceptor.inject(BreadcrumbRecord(timestamp: 1_000, name: "tap-checkout"))
        interceptor.inject(TraceRecord(
            timestamp: 1_000,
            name: "checkout",
            traceId: "trace-1",
            spanId: "span-1",
            startTime: 1_000,
            endTime: 1_200
        ))
        #expect(interceptor.flushSinks())

        let delivered = collected.values()
        #expect(delivered.contains { $0 is BreadcrumbRecord })
        #expect(delivered.contains { $0 is TraceRecord })
        subscription.cancel()
    }

    private func request(id: String) -> NetworkRequest {
        NetworkRequest(
            id: id,
            url: "https://api.example.com/users",
            method: .get,
            status: 200,
            startTime: 1_000,
            duration: 10,
            requestHeaders: [:],
            responseHeaders: [:],
            requestBodySize: 0,
            responseBodySize: 0,
            source: .urlSession
        )
    }
}

private enum SinkError: Error {
    case expected
}

private final class RecordBox: @unchecked Sendable {
    private let lock = NSLock()
    private var records: [NetworkRecord] = []

    func append(_ record: NetworkRecord) {
        lock.lock()
        records.append(record)
        lock.unlock()
    }

    func values() -> [NetworkRecord] {
        lock.lock()
        defer { lock.unlock() }
        return records
    }
}

private final class ContractRecordBox: @unchecked Sendable {
    private let lock = NSLock()
    private var records: [any ContractRecord] = []

    func append(_ record: any ContractRecord) {
        lock.lock()
        records.append(record)
        lock.unlock()
    }

    func values() -> [any ContractRecord] {
        lock.lock()
        defer { lock.unlock() }
        return records
    }
}

private final class SinkGate: @unchecked Sendable {
    private let entered = DispatchSemaphore(value: 0)
    private let released = DispatchSemaphore(value: 0)

    func enter() {
        entered.signal()
    }

    func waitForEntry() -> Bool {
        entered.wait(timeout: .now() + 1) == .success
    }

    func waitForRelease() {
        _ = released.wait(timeout: .now() + 2)
    }

    func release() {
        released.signal()
    }
}
