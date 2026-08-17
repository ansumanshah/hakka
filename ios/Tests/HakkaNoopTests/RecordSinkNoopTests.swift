import Foundation
import Testing
import HakkaCommon
@testable import HakkaNetworkNoop

@Suite struct RecordSinkNoopTests {
    @Test func sinkAPIIsAvailableInNoop() {
        let interceptor = HakkaInterceptor()
        let subscription = interceptor.addSink { _ in throw SinkError.expected }

        subscription.cancel()
        #expect(interceptor.flushSinks())
        #expect(interceptor.droppedSinkRecords() == 0)
    }

    @Test func injectIsNoOpInNoop() {
        let interceptor = HakkaInterceptor()
        interceptor.inject(BreadcrumbRecord(timestamp: 1_000, name: "tap"))
        #expect(interceptor.flushSinks())
        #expect(interceptor.droppedSinkRecords() == 0)
    }
}

private enum SinkError: Error {
    case expected
}
