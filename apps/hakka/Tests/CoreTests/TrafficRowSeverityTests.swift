import HakkaCore
import Testing

@Suite("TrafficRowSeverity")
struct TrafficRowSeverityTests {
    @Test func serverErrorIsError()
    async throws {
        #expect(TrafficRowSeverity(status: 500, transportError: false) == .error)
        #expect(TrafficRowSeverity(status: 503, transportError: false) == .error)
    }

    @Test func transportErrorOutranksStatus()
    async throws {
        #expect(TrafficRowSeverity(status: nil, transportError: true) == .error)
        #expect(TrafficRowSeverity(status: 200, transportError: true) == .error)
        #expect(TrafficRowSeverity(status: 404, transportError: true) == .error)
    }

    @Test func clientErrorIsWarning()
    async throws {
        #expect(TrafficRowSeverity(status: 400, transportError: false) == .warning)
        #expect(TrafficRowSeverity(status: 404, transportError: false) == .warning)
        #expect(TrafficRowSeverity(status: 499, transportError: false) == .warning)
    }

    @Test func boundariesSplitAt499And500()
    async throws {
        #expect(TrafficRowSeverity(status: 499, transportError: false) == .warning)
        #expect(TrafficRowSeverity(status: 500, transportError: false) == .error)
    }

    @Test func healthyTrafficCarriesNoStripe()
    async throws {
        #expect(TrafficRowSeverity(status: 200, transportError: false) == nil)
        #expect(TrafficRowSeverity(status: 301, transportError: false) == nil)
        #expect(TrafficRowSeverity(status: nil, transportError: false) == nil)
    }
}
