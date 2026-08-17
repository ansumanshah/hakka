import Testing
@testable import HakkaNetwork
import Foundation
import HakkaCommon

@Suite struct RetentionPolicyTests {
    @Test func noMaxAge() {
        let policy = RetentionPolicy(maxCount: 10)
        let store = LogStore(capacity: 10)
        store.add(NetworkRequest(url: "https://test.com", method: .get, startTime: 1))
        policy.enforce(on: store)
        #expect(store.count == 1) // nothing removed
    }

    @Test func maxAgeEnforcement() {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let policy = RetentionPolicy(maxCount: 10, maxAge: 60) // 60 seconds
        let store = LogStore(capacity: 10)

        // Add old request (2 minutes ago)
        store.add(NetworkRequest(id: "old", url: "https://test.com", method: .get, startTime: nowMs - 120_000))
        // Add recent request
        store.add(NetworkRequest(id: "recent", url: "https://test.com", method: .get, startTime: nowMs - 10_000))

        policy.enforce(on: store)
        #expect(store.request(byId: "old") == nil)
        #expect(store.request(byId: "recent") != nil)
    }
}
