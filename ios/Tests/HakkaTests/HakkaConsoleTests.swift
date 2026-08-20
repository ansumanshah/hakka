import Testing
import Foundation
@testable import HakkaCommon
import Dispatch
import os

// Thread-safe array for test observation under Swift 6 strict concurrency.
private final class LockedArray<T: Sendable>: @unchecked Sendable {
    private var storage: [T] = []
    private var lock = os_unfair_lock()

    func append(_ value: T) {
        os_unfair_lock_lock(&lock)
        storage.append(value)
        os_unfair_lock_unlock(&lock)
    }

    var snapshot: [T] {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        return storage
    }
}

@Suite struct HakkaConsoleTests {

    // Each test uses its own console to avoid shared state.

    @Test func addAndCount() {
        let c = HakkaConsole(capacity: 10)
        #expect(c.count == 0)
        c.log(.info, "hello")
        #expect(c.count == 1)
    }

    @Test func levelsPreserved() {
        let c = HakkaConsole(capacity: 10)
        c.log(.debug, "d")
        c.log(.info, "i")
        c.log(.warn, "w")
        c.log(.error, "e")
        let entries = c.entries
        #expect(entries.count == 4)
        #expect(entries[0].level == .debug)
        #expect(entries[1].level == .info)
        #expect(entries[2].level == .warn)
        #expect(entries[3].level == .error)
    }

    @Test func messagesPreserved() {
        let c = HakkaConsole(capacity: 10)
        c.log(.info, "alpha")
        c.log(.warn, "beta")
        let entries = c.entries
        #expect(entries.map(\.message) == ["alpha", "beta"])
    }

    @Test func ringBufferEviction() {
        let c = HakkaConsole(capacity: 3)
        c.log(.debug, "A")
        c.log(.debug, "B")
        c.log(.debug, "C")
        #expect(c.count == 3)
        c.log(.debug, "D") // evicts A
        #expect(c.count == 3)
        let msgs = c.entries.map(\.message)
        #expect(msgs == ["B", "C", "D"])
    }

    @Test func clear() {
        let c = HakkaConsole(capacity: 10)
        c.log(.info, "msg")
        c.clear()
        #expect(c.count == 0)
        #expect(c.entries.isEmpty)
    }

    @Test func orderingAfterWrap() {
        let c = HakkaConsole(capacity: 5)
        for i in 0..<8 {
            c.log(.debug, "\(i)")
        }
        // Buffer capacity=5; should hold messages 3,4,5,6,7
        let msgs = c.entries.map(\.message)
        #expect(msgs == ["3", "4", "5", "6", "7"])
    }

    @Test func convenienceHelpers() {
        let c = HakkaConsole(capacity: 10)
        c.debug("d")
        c.info("i")
        c.warn("w")
        c.error("e")
        let levels = c.entries.map(\.level)
        #expect(levels == [.debug, .info, .warn, .error])
    }

    @Test func observerReceivesEntries() {
        let c = HakkaConsole(capacity: 10)
        let received = LockedArray<ConsoleEntry>()
        let token = c.addObserver { entry in
            received.append(entry)
        }
        c.log(.info, "one")
        c.log(.warn, "two")
        // Token kept alive
        _ = token
        let msgs = received.snapshot.map(\.message)
        #expect(msgs == ["one", "two"])
    }

    @Test func observerCancelStopsDelivery() {
        let c = HakkaConsole(capacity: 10)
        let received = LockedArray<ConsoleEntry>()
        let token = c.addObserver { entry in
            received.append(entry)
        }
        c.log(.info, "before cancel")
        token.cancel()
        c.log(.info, "after cancel")
        let msgs = received.snapshot.map(\.message)
        #expect(msgs == ["before cancel"])
    }

    @Test func threadSafety() {
        let c = HakkaConsole(capacity: 200)
        let group = DispatchGroup()
        for i in 0..<200 {
            group.enter()
            DispatchQueue.global().async {
                c.log(.info, "msg-\(i)")
                group.leave()
            }
        }
        // Bounded: an unbounded DispatchGroup wait turns a lost completion into
        // a CI-length hang rather than a test failure.
        if group.wait(timeout: .now() + 10) == .timedOut { Issue.record("concurrent work did not finish") }
        #expect(c.count == 200)
    }

    @Test func consoleLevelOrdering() {
        #expect(ConsoleLevel.debug < .info)
        #expect(ConsoleLevel.info < .warn)
        #expect(ConsoleLevel.warn < .error)
    }

    @Test func consoleLevelLabels() {
        #expect(ConsoleLevel.debug.label == "DEBUG")
        #expect(ConsoleLevel.info.label  == "INFO")
        #expect(ConsoleLevel.warn.label  == "WARN")
        #expect(ConsoleLevel.error.label == "ERROR")
    }

    @Test func timestampIsPopulated() {
        let before = Int64(Date().timeIntervalSince1970 * 1000)
        let c = HakkaConsole(capacity: 10)
        c.log(.info, "ts-test")
        let after = Int64(Date().timeIntervalSince1970 * 1000)
        let ts = c.entries.first?.timestamp ?? 0
        #expect(ts >= before)
        #expect(ts <= after)
    }
}
