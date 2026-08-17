import Testing
@testable import HakkaNetwork
import Foundation
import HakkaCommon

// MARK: - RequestFilter Tests

@Suite struct RequestFilterTests {
    private func req(
        url: String = "https://api.example.com/users",
        method: HttpMethod = .get,
        status: Int? = 200,
        startTime: Int64 = 1_000
    ) -> NetworkRequest {
        NetworkRequest(id: UUID().uuidString, url: url, method: method, status: status, startTime: startTime)
    }

    @Test func emptyFilterMatchesEverything() {
        #expect(RequestFilter().matches(req()))
    }

    @Test func urlPatternMatch() {
        #expect(RequestFilter(urlPattern: "example.com").matches(req()))
        #expect(!RequestFilter(urlPattern: "other.com").matches(req()))
    }

    @Test func methodMatch() {
        #expect(RequestFilter(method: "GET").matches(req()))
        #expect(!RequestFilter(method: "POST").matches(req()))
    }

    @Test func statusRangeMatch() {
        #expect(RequestFilter(statusRange: 200...299).matches(req(status: 200)))
        #expect(!RequestFilter(statusRange: 200...299).matches(req(status: 404)))
        #expect(!RequestFilter(statusRange: 200...299).matches(req(status: nil)))
    }

    @Test func sinceMatch() {
        let sinceDate = Date(timeIntervalSince1970: 0.5) // 500ms epoch
        #expect(RequestFilter(since: sinceDate).matches(req(startTime: 1_000)))
        let futureDate = Date(timeIntervalSince1970: 2.0) // 2000ms epoch
        #expect(!RequestFilter(since: futureDate).matches(req(startTime: 1_000)))
    }

    @Test func combinedFiltersAllMustPass() {
        let filter = RequestFilter(urlPattern: "example.com", method: "GET", statusRange: 200...299)
        #expect(filter.matches(req()))
        #expect(!filter.matches(req(method: .post)))
        #expect(!filter.matches(req(status: 500)))
        #expect(!filter.matches(req(url: "https://other.com/path")))
    }

    // MARK: - Multiple criteria simultaneously

    @Test func filterByAllCriteriaSimultaneously() {
        let since = Date(timeIntervalSince1970: 0.5) // 500ms
        let filter = RequestFilter(
            urlPattern: "example.com",
            method: "POST",
            statusRange: 200...299,
            since: since
        )

        let matching = NetworkRequest(
            id: UUID().uuidString,
            url: "https://api.example.com/users",
            method: .post,
            status: 201,
            startTime: 1_000
        )
        #expect(filter.matches(matching))

        // Fails URL
        let badUrl = NetworkRequest(
            id: UUID().uuidString,
            url: "https://other.com/users",
            method: .post,
            status: 201,
            startTime: 1_000
        )
        #expect(!filter.matches(badUrl))

        // Fails method
        let badMethod = NetworkRequest(
            id: UUID().uuidString,
            url: "https://api.example.com/users",
            method: .get,
            status: 200,
            startTime: 1_000
        )
        #expect(!filter.matches(badMethod))

        // Fails status
        let badStatus = NetworkRequest(
            id: UUID().uuidString,
            url: "https://api.example.com/users",
            method: .post,
            status: 500,
            startTime: 1_000
        )
        #expect(!filter.matches(badStatus))

        // Fails since (too old)
        let tooOld = NetworkRequest(
            id: UUID().uuidString,
            url: "https://api.example.com/users",
            method: .post,
            status: 201,
            startTime: 100
        )
        #expect(!filter.matches(tooOld))
    }

    // MARK: - Status range edge cases

    @Test func statusRangeExactBoundary200() {
        let filter = RequestFilter(statusRange: 200...399)
        #expect(filter.matches(req(status: 200)))
    }

    @Test func statusRangeExactBoundary399() {
        let filter = RequestFilter(statusRange: 200...399)
        #expect(filter.matches(req(status: 399)))
    }

    @Test func statusRangeExactBoundary400() {
        let filter = RequestFilter(statusRange: 200...399)
        #expect(!filter.matches(req(status: 400)))
    }

    @Test func statusRangeExactBoundary199() {
        let filter = RequestFilter(statusRange: 200...399)
        #expect(!filter.matches(req(status: 199)))
    }

    @Test func statusRangeNilStatusNeverMatches() {
        let filter = RequestFilter(statusRange: 200...599)
        #expect(!filter.matches(req(status: nil)))
    }

    // MARK: - Empty URL pattern

    @Test func emptyUrlPatternMatchesNothing() {
        // In Swift, String.contains("") returns false, so an empty pattern matches nothing
        let filter = RequestFilter(urlPattern: "")
        #expect(!filter.matches(req(url: "https://api.example.com/users")))
        #expect(!filter.matches(req(url: "https://other.com/health")))
    }

    @Test func nilUrlPatternMatchesEverything() {
        // nil urlPattern means "no URL filter", matches everything
        let filter = RequestFilter(urlPattern: nil)
        #expect(filter.matches(req(url: "https://api.example.com/users")))
        #expect(filter.matches(req(url: "https://other.com/health")))
        #expect(filter.matches(req(url: "http://localhost:3000")))
    }

    // MARK: - Filter by since timestamp

    @Test func sinceExactBoundary() {
        // startTime=1000 means epoch 1.0s. since at exactly 1.0s should match.
        let since = Date(timeIntervalSince1970: 1.0) // exactly 1000ms
        let filter = RequestFilter(since: since)
        #expect(filter.matches(req(startTime: 1_000))) // exactly at boundary
        #expect(filter.matches(req(startTime: 1_001))) // just after
        #expect(!filter.matches(req(startTime: 999)))  // just before
    }
}

// MARK: - InMemoryStorage Tests

@Suite struct InMemoryStorageTests {
    private func req(
        id: String = UUID().uuidString,
        url: String = "https://api.example.com/users",
        method: HttpMethod = .get,
        status: Int? = 200,
        startTime: Int64 = 1_000
    ) -> NetworkRequest {
        NetworkRequest(id: id, url: url, method: method, status: status, startTime: startTime)
    }

    @Test func storeAndCount() {
        let storage = InMemoryStorage(capacity: 100)
        storage.store(req(id: "a"))
        storage.store(req(id: "b"))
        #expect(storage.count == 2)
    }

    @Test func clearEmptiesStorage() {
        let storage = InMemoryStorage(capacity: 100)
        storage.store(req())
        storage.clear()
        #expect(storage.count == 0)
        #expect(storage.query(filter: RequestFilter()).count == 0)
    }

    @Test func queryNoFilterReturnsAll() {
        let storage = InMemoryStorage(capacity: 100)
        storage.store(req(id: "a"))
        storage.store(req(id: "b"))
        storage.store(req(id: "c"))
        #expect(storage.query(filter: RequestFilter()).count == 3)
    }

    @Test func queryFiltersByURL() {
        let storage = InMemoryStorage(capacity: 100)
        storage.store(req(url: "https://api.example.com/users"))
        storage.store(req(url: "https://api.example.com/posts"))
        storage.store(req(url: "https://other.com/health"))
        #expect(storage.query(filter: RequestFilter(urlPattern: "example.com")).count == 2)
    }

    @Test func queryFiltersByMethod() {
        let storage = InMemoryStorage(capacity: 100)
        storage.store(req(method: .get))
        storage.store(req(method: .post))
        storage.store(req(method: .post))
        #expect(storage.query(filter: RequestFilter(method: "POST")).count == 2)
    }

    @Test func queryFiltersByStatusRange() {
        let storage = InMemoryStorage(capacity: 100)
        storage.store(req(status: 200))
        storage.store(req(status: 404))
        storage.store(req(status: 500))
        storage.store(req(status: nil))
        #expect(storage.query(filter: RequestFilter(statusRange: 400...599)).count == 2)
    }
}

// MARK: - LogStore Query Tests

@Suite struct LogStoreQueryTests {
    private func req(id: String, url: String = "https://api.example.com/users", startTime: Int64 = 1_000) -> NetworkRequest {
        NetworkRequest(id: id, url: url, method: .get, status: 200, startTime: startTime)
    }

    @Test func queryEmptyFilterReturnsAll() {
        let store = LogStore(capacity: 100)
        store.add(req(id: "a"))
        store.add(req(id: "b"))
        #expect(store.query(filter: RequestFilter()).count == 2)
    }

    @Test func queryFiltersByURL() {
        let store = LogStore(capacity: 100)
        store.add(req(id: "match", url: "https://api.example.com/users"))
        store.add(req(id: "no-match", url: "https://other.com/health"))
        let results = store.query(filter: RequestFilter(urlPattern: "example.com"))
        #expect(results.count == 1)
        #expect(results[0].id == "match")
    }

    @Test func queryFiltersBySince() {
        let store = LogStore(capacity: 100)
        store.add(req(id: "old", startTime: 100))
        store.add(req(id: "recent", startTime: 2_000))
        let since = Date(timeIntervalSince1970: 1.0) // 1000ms
        let results = store.query(filter: RequestFilter(since: since))
        #expect(results.count == 1)
        #expect(results[0].id == "recent")
    }
}
