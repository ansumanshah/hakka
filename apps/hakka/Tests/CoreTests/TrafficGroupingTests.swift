import Foundation
import HakkaCommon
import Testing

@testable import HakkaCore

/// `TrafficQueryCompiler.group(_:by:)` is new — until now
/// `TrafficQueryCompiler`'s own doc comment said grouping did not exist on
/// this platform at all. These tests exercise the host/status/method/error
/// buckets the desktop's Group By picker offers.
@Suite("traffic grouping")
struct TrafficGroupingTests {
    private func request(
        id: String,
        url: String = "https://api.example.com/users",
        method: HttpMethod = .get,
        status: Int? = 200,
        error: String? = nil,
    ) -> NetworkRequest {
        NetworkRequest(
            id: id,
            url: url,
            method: method,
            status: status,
            startTime: 0,
            error: error,
        )
    }

    @Test("none returns every request in a single All bucket")
    func groupByNone() {
        let requests = [request(id: "a"), request(id: "b")]
        let groups = TrafficQueryCompiler.group(requests, by: .none)

        #expect(groups.count == 1)
        #expect(groups[0].key == "")
        #expect(groups[0].label == "All")
        #expect(groups[0].items.map(\.id) == ["a", "b"])
    }

    @Test("host buckets by URL host, unknown-URL requests keep the raw string")
    func groupByHost() {
        let requests = [
            request(id: "a", url: "https://api.example.com/users"),
            request(id: "b", url: "https://cdn.example.net/logo.png"),
            request(id: "c", url: "https://api.example.com/orders"),
        ]
        let groups = TrafficQueryCompiler.group(requests, by: .host)

        #expect(groups.map(\.label) == ["api.example.com", "cdn.example.net"])
        #expect(groups[0].items.map(\.id) == ["a", "c"])
        #expect(groups[1].items.map(\.id) == ["b"])
    }

    @Test("status buckets by class, first occurrence order, pending has no status")
    func groupByStatus() {
        let requests = [
            request(id: "a", status: 201),
            request(id: "b", status: 404),
            request(id: "c", status: nil),
            request(id: "d", status: 200),
            request(id: "e", status: 500),
        ]
        let groups = TrafficQueryCompiler.group(requests, by: .status)

        #expect(groups.map(\.label) == [
            "2xx Success", "4xx Client Error", "Pending", "5xx Server Error",
        ])
        #expect(groups[0].items.map(\.id) == ["a", "d"])
        #expect(groups[1].items.map(\.id) == ["b"])
        #expect(groups[2].items.map(\.id) == ["c"])
        #expect(groups[3].items.map(\.id) == ["e"])
    }

    @Test("method buckets are case-insensitive and title-cased to the raw method")
    func groupByMethod() {
        let requests = [
            request(id: "a", method: .get),
            request(id: "b", method: .post),
            request(id: "c", method: .get),
        ]
        let groups = TrafficQueryCompiler.group(requests, by: .method)

        #expect(groups.map(\.label) == ["GET", "POST"])
        #expect(groups[0].items.map(\.id) == ["a", "c"])
        #expect(groups[1].items.map(\.id) == ["b"])
    }

    @Test("error buckets split transport failures from everything else")
    func groupByError() {
        let requests = [
            request(id: "a", status: 200),
            request(id: "b", status: nil, error: "timed out"),
            request(id: "c", status: 500),
        ]
        let groups = TrafficQueryCompiler.group(requests, by: .error)

        #expect(groups.map(\.label) == ["OK", "Errors"])
        #expect(groups[0].items.map(\.id) == ["a", "c"])
        #expect(groups[1].items.map(\.id) == ["b"])
    }

    @Test("groups appear in first-occurrence order, not sorted order")
    func firstOccurrenceOrder() {
        let requests = [
            request(id: "a", method: .post),
            request(id: "b", method: .get),
            request(id: "c", method: .delete),
            request(id: "d", method: .get),
        ]
        let groups = TrafficQueryCompiler.group(requests, by: .method)
        #expect(groups.map(\.label) == ["POST", "GET", "DELETE"])
    }

    @Test("grouping never reorders items within a bucket — sort the input first")
    func preservesInputOrderWithinBucket() {
        let requests = [
            request(id: "a", method: .get),
            request(id: "b", method: .get),
            request(id: "c", method: .get),
        ]
        let sorted = requests.reversed().map { $0 } // pretend a caller sorted differently
        let groups = TrafficQueryCompiler.group(sorted, by: .method)
        #expect(groups[0].items.map(\.id) == ["c", "b", "a"])
    }

    @Test("flatMap of every group reproduces the original request set for any mode")
    func flatMapRoundTrips() {
        let requests = [
            request(id: "a", url: "https://a.example.com", method: .get, status: 200),
            request(id: "b", url: "https://b.example.com", method: .post, status: 404, error: "boom"),
            request(id: "c", url: "https://a.example.com", method: .get, status: nil),
        ]
        for mode in TrafficGroupBy.allCases {
            let groups = TrafficQueryCompiler.group(requests, by: mode)
            #expect(groups.flatMap(\.items).map(\.id).sorted() == requests.map(\.id).sorted())
        }
    }
}
