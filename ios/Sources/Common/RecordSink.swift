import Foundation

/// Receives processed records after redaction, normalization, and store mutation.
public typealias RecordSink = @Sendable (any ContractRecord) throws -> Void

/// Handle returned when registering a sink. Call `cancel()` to stop delivery.
public final class SinkSubscription: @unchecked Sendable {
    private let lock = NSLock()
    private var onCancel: (() -> Void)?

    public init(_ onCancel: @escaping () -> Void = {}) {
        self.onCancel = onCancel
    }

    public func cancel() {
        lock.lock()
        let action = onCancel
        onCancel = nil
        lock.unlock()
        action?()
    }

    deinit {
        cancel()
    }
}

public final class RecordSinkHub: @unchecked Sendable {
    private let lock = NSLock()
    private var sinks: [UUID: RecordSink] = [:]
    private var pending = 0
    private var dropped = 0
    private let maxPending: Int
    private let queue = DispatchQueue(label: "com.noodleapps.hakka.record-sinks", qos: .utility)
    private let queueKey = DispatchSpecificKey<Void>()

    public init(maxPending: Int = 500) {
        self.maxPending = max(1, maxPending)
        queue.setSpecific(key: queueKey, value: ())
    }

    public func add(_ sink: @escaping RecordSink) -> SinkSubscription {
        let id = UUID()
        lock.lock()
        sinks[id] = sink
        lock.unlock()
        return SinkSubscription { [weak self] in
            self?.remove(id)
        }
    }

    public func emit(_ record: any ContractRecord) {
        let snapshot = reserveDelivery()
        guard !snapshot.isEmpty else { return }

        queue.async { [weak self] in
            defer { self?.finishDelivery() }
            snapshot.forEach { sink in
                do {
                    try sink(record)
                } catch {
                    // Sink failures should not leak back into capture processing.
                }
            }
        }
    }

    public func flush(timeout: TimeInterval = 5) -> Bool {
        if DispatchQueue.getSpecific(key: queueKey) != nil {
            return true
        }
        let semaphore = DispatchSemaphore(value: 0)
        queue.async {
            semaphore.signal()
        }
        return semaphore.wait(timeout: .now() + timeout) == .success
    }

    public func droppedCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return dropped
    }

    private func remove(_ id: UUID) {
        lock.lock()
        sinks.removeValue(forKey: id)
        lock.unlock()
    }

    private func reserveDelivery() -> [RecordSink] {
        lock.lock()
        defer { lock.unlock() }
        guard !sinks.isEmpty else { return [] }
        guard pending < maxPending else {
            dropped += 1
            return []
        }
        pending += 1
        return Array(sinks.values)
    }

    private func finishDelivery() {
        lock.lock()
        pending = max(0, pending - 1)
        lock.unlock()
    }
}
