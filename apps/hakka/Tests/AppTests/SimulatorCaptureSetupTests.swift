import Foundation
@testable import HakkaApp
import HakkaCommon
import Testing

@MainActor
@Suite("Simulator capture setup")
struct SimulatorCaptureSetupTests {
    @Test func performsOwnedSetupInOrderAndRequiresDeliveredHTTPS() async {
        let runtime = FakeSimulatorSetupRuntime()
        let session = FakeSimulatorCaptureSession(log: runtime.log)
        let setup = SimulatorCaptureSetup(runtime: runtime)
        setup.selectedTargetID = runtime.target.id
        var requests: [NetworkRequest] = []
        runtime.onOpen = { url in requests = [Self.request(url: url)] }
        await setup.setUp(session: session, bridgePort: 8989, requests: { requests })
        #expect(runtime.log.events == ["discover", "reserve", "route-before-start:true", "fingerprint", "boot", "install", "open"])
        #expect(setup.engine == .complete && setup.routing == .complete)
        #expect(setup.certificate == .complete && setup.https == .complete && setup.delivery == .complete)
        #expect(setup.proofRequestID == requests.first?.id)
        #expect(setup.certificatePersists)
        #expect(!runtime.reservation.isReleased)
        _ = await session.shutdown()
    }

    @Test func missingSelectionDoesNotReserveOrMutateCapture() async {
        let runtime = FakeSimulatorSetupRuntime()
        let session = FakeSimulatorCaptureSession(log: runtime.log)
        let setup = SimulatorCaptureSetup(runtime: runtime)
        await setup.setUp(session: session, bridgePort: 8989, requests: { [] })
        #expect(runtime.log.events.isEmpty)
        #expect(!session.isActive && !session.routeThisMac)
        #expect(setup.needsManualSetup)
    }

    @Test func conflictingActiveCaptureIsPreserved() async {
        let runtime = FakeSimulatorSetupRuntime()
        let session = FakeSimulatorCaptureSession(log: runtime.log)
        session.state = .running; session.isActive = true
        let setup = SimulatorCaptureSetup(runtime: runtime)
        setup.selectedTargetID = runtime.target.id
        await setup.setUp(session: session, bridgePort: 8989, requests: { [] })
        #expect(runtime.log.events == ["discover"])
        #expect(session.isActive && !session.routeThisMac)
        #expect(!runtime.didInstall)
    }

    @Test func installationFailureRestoresNewlyOwnedCaptureAndToggle() async {
        let runtime = FakeSimulatorSetupRuntime()
        runtime.installError = SimulatorSetupFailure(message: "Certificate rejected")
        let session = FakeSimulatorCaptureSession(log: runtime.log)
        let setup = SimulatorCaptureSetup(runtime: runtime)
        setup.selectedTargetID = runtime.target.id
        await setup.setUp(session: session, bridgePort: 8989, requests: { [] })
        #expect(runtime.log.events.last == "shutdown")
        #expect(!session.isActive && !session.routeThisMac)
        #expect(runtime.reservation.isReleased)
        #expect(setup.certificate == .failed && setup.https == .pending)
        #expect(setup.message.contains("trust may remain"))
    }

    @Test func cancellationAfterInstallationCleansCaptureWithoutRemovingTrust() async {
        let runtime = FakeSimulatorSetupRuntime()
        let session = FakeSimulatorCaptureSession(log: runtime.log)
        let setup = SimulatorCaptureSetup(runtime: runtime)
        setup.selectedTargetID = runtime.target.id
        runtime.onOpen = { _ in setup.cancel() }
        await setup.setUp(session: session, bridgePort: 8989, requests: { [] })
        #expect(setup.certificate == .complete && setup.certificatePersists)
        #expect(setup.https == .failed && setup.delivery == .failed)
        #expect(!session.isActive && !session.routeThisMac)
        #expect(runtime.reservation.isReleased)
        #expect(setup.message.contains("cancelled"))
    }

    @Test func cleanupFailureRetainsReservationAndOwnedRoutingChoice() async {
        let runtime = FakeSimulatorSetupRuntime()
        runtime.installError = SimulatorSetupFailure(message: "Certificate rejected")
        let session = FakeSimulatorCaptureSession(log: runtime.log)
        session.stopSucceeds = false
        let setup = SimulatorCaptureSetup(runtime: runtime)
        setup.selectedTargetID = runtime.target.id
        await setup.setUp(session: session, bridgePort: 8989, requests: { [] })
        #expect(session.isActive && session.routeThisMac)
        #expect(!runtime.reservation.isReleased)
        #expect(setup.message.contains("cleanup needs attention"))
        session.stopSucceeds = true
        _ = await session.shutdown()
    }

    @Test func deliveredHTTPOrMissingBodyCannotClaimHTTPSProof() async {
        for invalidHTTPS in [false, true] {
            let runtime = FakeSimulatorSetupRuntime()
            let session = FakeSimulatorCaptureSession(log: runtime.log)
            let setup = SimulatorCaptureSetup(runtime: runtime)
            setup.selectedTargetID = runtime.target.id
            var requests: [NetworkRequest] = []
            runtime.onOpen = { url in
                let value = invalidHTTPS ? url : URL(string: url.absoluteString.replacingOccurrences(of: "https:", with: "http:"))!
                requests = [Self.request(url: value, body: invalidHTTPS ? nil : "example")]
            }
            await setup.setUp(session: session, bridgePort: 8989, requests: { requests })
            #expect(setup.https == .failed)
            #expect(setup.proofRequestID == nil)
            #expect(setup.delivery == (invalidHTTPS ? .complete : .failed))
            #expect(!session.isActive)
        }
    }

    @Test func failureWhileReusingRoutedCaptureDoesNotStopTheExistingSession() async {
        let runtime = FakeSimulatorSetupRuntime()
        runtime.installError = SimulatorSetupFailure(message: "Certificate rejected")
        let session = FakeSimulatorCaptureSession(log: runtime.log)
        session.state = .running; session.isActive = true; session.isSystemProxyRoutingActive = true
        let setup = SimulatorCaptureSetup(runtime: runtime)
        setup.selectedTargetID = runtime.target.id
        await setup.setUp(session: session, bridgePort: 8989, requests: { [] })
        #expect(session.isActive && session.isSystemProxyRoutingActive)
        #expect(!runtime.log.events.contains("shutdown"))
        #expect(runtime.reservation.isReleased)
    }

    @Test func preexistingRecordCannotBeReusedAsTargetHTTPSProof() async {
        let runtime = FakeSimulatorSetupRuntime()
        let session = FakeSimulatorCaptureSession(log: runtime.log)
        let setup = SimulatorCaptureSetup(runtime: runtime)
        setup.selectedTargetID = runtime.target.id
        let existingID = UUID().uuidString
        var requests = [NetworkRequest(id: existingID, url: "https://example.com/", method: .get,
                                       status: 200, startTime: 0, responseBody: "previous response")]
        runtime.onOpen = { url in
            // Even a reused ID updated to the current nonce is not a newly delivered request.
            requests = [NetworkRequest(id: existingID, url: url.absoluteString, method: .get,
                                       status: 200, startTime: Int64(Date().timeIntervalSince1970 * 1000), responseBody: "response")]
        }
        await setup.setUp(session: session, bridgePort: 8989, requests: { requests })
        #expect(setup.https == .failed && setup.delivery == .failed)
        #expect(setup.proofRequestID == nil)
        #expect(!session.isActive && runtime.reservation.isReleased)
    }

    private static func request(url: URL, body: String? = "example") -> NetworkRequest {
        NetworkRequest(url: url.absoluteString, method: .get, status: 200,
                       startTime: Int64(Date().timeIntervalSince1970 * 1000), responseBody: body)
    }
}

@MainActor
private final class SimulatorSetupEventLog { var events: [String] = [] }

@MainActor
private final class FakeSimulatorSetupRuntime: SimulatorSetupRunning {
    let log = SimulatorSetupEventLog()
    let target = SimulatorSetupTarget(id: UUID().uuidString, name: "Test iPhone", state: "Shutdown")
    let reservation = SimulatorSetupReservation()
    var installError: (any Error)?
    var didInstall = false
    var onOpen: ((URL) -> Void)?

    func discoverTargets() async throws -> [SimulatorSetupTarget] {
        log.events.append("discover"); return [target]
    }

    func reserve(targetID _: String, directory _: URL) throws -> SimulatorSetupReservation {
        log.events.append("reserve"); return reservation
    }

    func boot(targetID _: String) async throws {
        log.events.append("boot")
    }

    func certificateFingerprint(path _: String) throws -> String {
        log.events.append("fingerprint"); return "public-ca-sha256"
    }

    func installCertificate(targetID _: String, path _: String) async throws {
        log.events.append("install")
        if let installError {
            throw installError
        }
        didInstall = true
    }

    func openSafari(targetID _: String, url: URL) async throws {
        log.events.append("open"); onOpen?(url)
    }

    func pause() async throws {
        try Task.checkCancellation()
    }
}

@MainActor
private final class FakeSimulatorCaptureSession: SimulatorCaptureSession {
    var state = ProxyCaptureModel.State.stopped
    var isActive = false
    var routeThisMac = false
    var isSystemProxyRoutingActive = false
    var isSystemProxyRoutingRecoveryPending = false
    var isRecoveringSystemProxyRouting = false
    let configurationDirectory = FileManager.default.temporaryDirectory
    var certificatePath: String? = "/tmp/public-ca.pem"
    var message = "Test session"
    var stopSucceeds = true
    let log: SimulatorSetupEventLog

    init(log: SimulatorSetupEventLog) {
        self.log = log
    }

    func start(bridgePort _: UInt16) {
        log.events.append("route-before-start:\(routeThisMac)")
        state = .running; isActive = true; isSystemProxyRoutingActive = routeThisMac
    }

    func shutdown() async -> Bool {
        log.events.append("shutdown")
        if stopSucceeds {
            state = .stopped; isActive = false; isSystemProxyRoutingActive = false
        }
        return stopSucceeds
    }
}
