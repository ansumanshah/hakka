import Foundation
import HakkaCommon
import Observation

@MainActor
protocol SimulatorCaptureSession: AnyObject {
    var state: ProxyCaptureModel.State { get }
    var isActive: Bool { get }
    var routeThisMac: Bool { get set }
    var isSystemProxyRoutingActive: Bool { get }
    var isSystemProxyRoutingRecoveryPending: Bool { get }
    var isRecoveringSystemProxyRouting: Bool { get }
    var configurationDirectory: URL { get }
    var certificatePath: String? { get }
    var message: String { get }
    var setupCaptureIdentity: ObjectIdentifier? { get }
    var captureTLSHostScope: TLSHostScope { get }
    func snapshotSetupTLSConfiguration() -> ProxyTLSConfigurationSnapshot?
    func applySetupTLSHostScope(_ scope: TLSHostScope)
    func restoreSetupTLSConfiguration(_ snapshot: ProxyTLSConfigurationSnapshot, appliedScope: TLSHostScope)
    func start(bridgePort: UInt16)
    func shutdown() async -> Bool
}

extension SimulatorCaptureSession {
    var setupCaptureIdentity: ObjectIdentifier? { ObjectIdentifier(self) }
    var captureTLSHostScope: TLSHostScope { TLSHostScope(mode: .allowOnly, entries: [TLSHostScopeEntry(host: "example.com")]) }
    func snapshotSetupTLSConfiguration() -> ProxyTLSConfigurationSnapshot? { nil }
    func applySetupTLSHostScope(_ scope: TLSHostScope) {}
    func restoreSetupTLSConfiguration(_ snapshot: ProxyTLSConfigurationSnapshot, appliedScope: TLSHostScope) {}
}

extension ProxyCaptureModel: SimulatorCaptureSession {
    var setupCaptureIdentity: ObjectIdentifier? { deviceSetupProcessIdentity }
    var captureTLSHostScope: TLSHostScope { activeTLSHostScope ?? tlsHostScope }
    func applySetupTLSHostScope(_ scope: TLSHostScope) { tlsHostScope = scope }

}

/// One user-initiated workflow owns routing, target trust installation, and target traffic proof.
@MainActor
@Observable
final class SimulatorCaptureSetup {
    enum CheckState: Equatable { case pending, working, complete, failed }
    private(set) var targets: [SimulatorSetupTarget] = []
    var selectedTargetID: String?
    private(set) var isRefreshingTargets = false
    private(set) var isSettingUp = false
    private(set) var message = "Choose a Simulator. Setup routes this Mac, boots the selected target if needed, installs persistent public CA trust, and opens a test URL in Safari."
    private(set) var engine = CheckState.pending
    private(set) var routing = CheckState.pending
    private(set) var certificate = CheckState.pending
    private(set) var https = CheckState.pending
    private(set) var delivery = CheckState.pending
    private(set) var caFingerprint: String?
    private(set) var certificatePersists = false
    private(set) var certificateInstallationAttempted = false
    private(set) var proofRequestID: String?
    private(set) var proofURL: URL?
    private(set) var needsManualSetup = false
    @ObservationIgnored private let runtime: any SimulatorSetupRunning
    @ObservationIgnored private var setupTask: Task<Void, Never>?
    @ObservationIgnored private var monitor: Task<Void, Never>?
    @ObservationIgnored private var reservation: SimulatorSetupReservation?
    @ObservationIgnored private var ownsCapture = false
    @ObservationIgnored private var ownedSession: (any SimulatorCaptureSession)?
    private(set) var reservedTargetID: String?
    private(set) var activeCaptureHosts: [String] = []
    @ObservationIgnored private var tlsSnapshot: ProxyTLSConfigurationSnapshot?
    @ObservationIgnored private var setupTLSScope: TLSHostScope?

    var hasReservation: Bool { reservation != nil }
    var ownsSetupCapture: Bool { ownsCapture && isSetupCaptureCurrent }
    var isSetupCaptureCurrent: Bool {
        guard let session = ownedSession else { return false }
        return session.setupCaptureIdentity == captureIdentity
    }
    private var hasReplacementCapture: Bool {
        guard let currentIdentity = ownedSession?.setupCaptureIdentity else { return false }
        return currentIdentity != captureIdentity
    }
    @ObservationIgnored private var captureIdentity: ObjectIdentifier?
    @ObservationIgnored private var previousRoutingChoice = false

    init(runtime: any SimulatorSetupRunning = SimulatorSetupRuntime()) {
        self.runtime = runtime
    }

    func refreshTargets() async {
        guard !isRefreshingTargets, !isSettingUp else { return }
        isRefreshingTargets = true
        defer { isRefreshingTargets = false }
        do {
            targets = try await runtime.discoverTargets()
            if let selectedTargetID, !targets.contains(where: { $0.id == selectedTargetID }) {
                self.selectedTargetID = nil
            }
        } catch {
            targets = []
            selectedTargetID = nil
            message = "Could not discover Simulators: \(error.localizedDescription). Use manual setup."
            needsManualSetup = true
        }
    }

    func setUp(proxy: ProxyCaptureModel, traffic: TrafficModel) async {
        await setUp(session: proxy, bridgePort: traffic.isRunning ? traffic.boundPort : nil, requests: { traffic.requests })
    }

    func cancel() {
        setupTask?.cancel()
    }

    /// Simulator setup currently requires Mac-wide routing, which agent calls may never enable.
    static let agentStartBlockedReason = "simulator_isolated_routing_unavailable"
    static let agentStartUnavailableMessage = "Agent Simulator setup is unavailable because this workflow requires Mac-wide HTTP and HTTPS proxy routing. Use the explicit manual GUI workflow; isolated Simulator routing is not implemented."

    @discardableResult
    func startForAgent(targetID: String, hosts: [String] = [], proxy: ProxyCaptureModel, traffic: TrafficModel) -> Bool {
        // Refuse before consulting traffic, reserving a target, or changing capture configuration.
        false
    }

    @discardableResult
    func startForAgent(targetID: String, hosts: [String] = [], session: any SimulatorCaptureSession, bridgePort: UInt16?,
                       requests: @escaping @MainActor () -> [NetworkRequest], agentControlAllowed: Bool) -> Bool {
        // Keep direct coordinator invocation subject to the same isolation boundary as MCP.
        false
    }

    func cancelForAgent(agentControlAllowed: Bool) async -> Bool {
        guard agentControlAllowed else { return false }
        await cancelAndWait()
        return true
    }

    func cancelAndWait() async {
        let task = setupTask
        task?.cancel()
        await task?.value
    }

    /// Only the setup's own capture may be stopped. Borrowed desktop capture stays owned by its caller.
    func stopOwnedCapture(agentControlAllowed: Bool) async -> Bool {
        guard agentControlAllowed else { return false }
        await cancelAndWait()
        guard ownsCapture, let session = ownedSession else { return !hasReservation }
        monitor?.cancel(); monitor = nil
        await cleanupFailure(session: session)
        return !hasReservation
    }

    /// Session injection preserves real behavior without launching a proxy or changing device settings in tests.
    func setUp(session: any SimulatorCaptureSession, bridgePort: UInt16?, requests: @escaping @MainActor () -> [NetworkRequest]) async {
        guard !isSettingUp else { return }
        guard reservation == nil else { message = "This setup still owns its Simulator reservation. Stop capture and finish restoring routing before starting another setup."; return }
        beginSetup(session: session, bridgePort: bridgePort, requests: requests)
        guard let task = setupTask else { return }
        await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
    }

    private func beginSetup(session: any SimulatorCaptureSession, bridgePort: UInt16?, requests: @escaping @MainActor () -> [NetworkRequest], scope: TLSHostScope = TLSHostScope(mode: .allowOnly, entries: [TLSHostScopeEntry(host: "example.com")])) {
        let targetID = selectedTargetID
        engine = .pending; routing = .pending; certificate = .pending; https = .pending; delivery = .pending
        caFingerprint = nil; proofRequestID = nil; proofURL = nil; needsManualSetup = false
        certificateInstallationAttempted = false
        ownsCapture = false
        certificatePersists = false
        setupTLSScope = scope
        activeCaptureHosts = []
        isSettingUp = true
        setupTask = Task { [self] in
            await perform(targetID: targetID, session: session, bridgePort: bridgePort, requests: requests)
            setupTask = nil
            isSettingUp = false
        }
    }

    private func perform(targetID: String?, session: any SimulatorCaptureSession, bridgePort: UInt16?, requests: @escaping @MainActor () -> [NetworkRequest]) async {
        do {
            guard let id = targetID, UUID(uuidString: id) != nil else { throw failure("Choose an exact Simulator before setup.") }
            // Refresh read-only inventory so a removed or unavailable target cannot be booted by stale UI state.
            let available = try await runtime.discoverTargets()
            targets = available
            guard let target = available.first(where: { $0.id == id }) else { throw failure("The selected Simulator is no longer available.") }
            guard let bridgePort else { throw failure("Start the native traffic bridge before Simulator setup.") }
            guard !session.isRecoveringSystemProxyRouting, !session.isSystemProxyRoutingRecoveryPending else { throw failure("Resolve the pending Mac proxy restoration before setup.") }
            if session.isActive {
                guard session.captureTLSHostScope.mode == .allowOnly,
                      (setupTLSScope?.enabledHosts ?? ["example.com"]).allSatisfy({ session.captureTLSHostScope.enabledHosts.contains($0) }) else {
                    throw failure("Existing capture must already use capture-only TLS scope including example.com and requested hosts. Stop it before Simulator setup.")
                }
                guard session.state == .running, session.isSystemProxyRoutingActive else { throw failure("Existing capture has conflicting routing. Stop it before Simulator setup.") }
            }
            try Task.checkCancellation()
            reservation = try runtime.reserve(targetID: id, directory: session.configurationDirectory)
            reservedTargetID = id
            ownedSession = session
            previousRoutingChoice = session.routeThisMac
            if !session.isActive {
                ownsCapture = true
                tlsSnapshot = session.snapshotSetupTLSConfiguration()
                if let scope = setupTLSScope { session.applySetupTLSHostScope(scope) }
                session.routeThisMac = true
                engine = .working; routing = .working
                message = "Starting capture and routing this Mac for the selected Simulator…"
                session.start(bridgePort: bridgePort)
            }
            activeCaptureHosts = session.captureTLSHostScope.enabledHosts
            captureIdentity = session.setupCaptureIdentity
            try await awaitRouting(session)
            engine = .complete; routing = .complete
            guard let path = session.certificatePath else { throw failure("Capture has no public CA certificate yet.") }
            certificate = .working
            caFingerprint = try runtime.certificateFingerprint(path: path)
            try Task.checkCancellation()
            if !target.isBooted {
                message = "Booting \(target.name)…"
                try await runtime.boot(targetID: id)
            }
            try Task.checkCancellation()
            message = "Installing the public CA in \(target.name). Trust remains after capture stops."
            certificateInstallationAttempted = true
            try await runtime.installCertificate(targetID: id, path: path)
            certificate = .complete
            certificatePersists = true
            try Task.checkCancellation()
            let nonce = UUID().uuidString
            let url = URL(string: "https://example.com/?hakka_setup=\(nonce)")!
            let previousIDs = Set(requests().map(\.id))
            let startedAt = Int64(Date().timeIntervalSince1970 * 1000)
            proofURL = url
            https = .working; delivery = .working
            message = "Opening the HTTPS test in \(target.name)’s Safari and waiting for Live Traffic delivery…"
            try await runtime.openSafari(targetID: id, url: url)
            try await awaitProof(nonce: nonce, previousIDs: previousIDs, startedAt: startedAt, session: session, requests: requests)
            message = "HTTPS test delivered from the selected Simulator browser. This proves this test request, not trust or capture for every app. The installed CA remains in that Simulator."
            startReservationMonitor(session: session)
        } catch {
            markWorkingChecksFailed()
            needsManualSetup = true
            let reason = error is CancellationError ? "Simulator setup cancelled." : error.localizedDescription
            message = "\(reason) Continue with manual setup."
            if certificatePersists {
                message += " The installed CA remains; no preexisting certificates were removed."
            } else if certificateInstallationAttempted {
                message += " Certificate installation was attempted; trust may remain in the selected Simulator. No certificates were removed."
            }
            await cleanupFailure(session: session)
        }
    }

    private func awaitRouting(_ session: any SimulatorCaptureSession) async throws {
        for _ in 0 ..< 200 {
            try Task.checkCancellation()
            guard isSetupCaptureCurrent else { throw failure("The capture session changed during Simulator setup.") }
            if session.state == .failed {
                throw failure(session.message)
            }
            if session.state == .running, session.isSystemProxyRoutingActive {
                return
            }
            if !session.isActive {
                throw failure("Capture stopped before Mac routing was ready. \(session.message)")
            }
            try await runtime.pause()
        }
        throw failure("Capture or Mac routing did not become ready in time. \(session.message)")
    }

    private func awaitProof(nonce: String, previousIDs: Set<String>, startedAt: Int64, session: any SimulatorCaptureSession,
                            requests: @escaping @MainActor () -> [NetworkRequest]) async throws
    {
        for _ in 0 ..< 300 {
            try Task.checkCancellation()
            guard isSetupCaptureCurrent, session.state == .running, session.isSystemProxyRoutingActive else { throw failure("Capture or Mac routing stopped or changed before the target test completed.") }
            if let request = requests().first(where: { request in
                guard !previousIDs.contains(request.id), request.startTime >= startedAt,
                      let components = URLComponents(string: request.url), components.scheme == "https",
                      components.host == "example.com" else { return false }
                return components.queryItems?.contains(where: { $0.name == "hakka_setup" && $0.value == nonce }) == true
            }) {
                delivery = .complete
                if let error = request.error {
                    throw failure("The Simulator HTTPS request failed: \(error)")
                }
                if let status = request.status {
                    guard (200 ..< 300).contains(status), let body = request.responseBody, !body.isEmpty else {
                        throw failure("The target request arrived, but a successful decrypted HTTPS response body was not delivered.")
                    }
                    https = .complete
                    proofRequestID = request.id
                    return
                }
            }
            try await runtime.pause()
        }
        throw failure("No completed HTTPS test from the selected Simulator reached Live Traffic in time. A Mac connection test cannot substitute for this proof.")
    }

    static func captureScope(hosts: [String]) -> TLSHostScope? {
        guard hosts.count <= 32, hosts.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { return nil }
        let scope = TLSHostScope(mode: .allowOnly, entries: (hosts + ["example.com"]).map { TLSHostScopeEntry(host: $0) })
        guard scope.validationMessage == nil else { return nil }
        return scope
    }

    private func restoreTLSConfiguration(session: any SimulatorCaptureSession) {
        if let snapshot = tlsSnapshot, let scope = setupTLSScope {
            session.restoreSetupTLSConfiguration(snapshot, appliedScope: scope)
        }
        tlsSnapshot = nil
    }

    private func releaseReservation() {
        reservation?.release(); reservation = nil; reservedTargetID = nil; ownedSession = nil
        captureIdentity = nil; ownsCapture = false
    }

    private func cleanupFailure(session: any SimulatorCaptureSession) async {
        // A replacement child can launch only after the original ends. It owns its own routing choice.
        if hasReplacementCapture {
            restoreTLSConfiguration(session: session)
            releaseReservation()
            return
        }
        if ownsCapture {
            // Cleanup uses an uncancelled task so cancellation cannot skip native restoration.
            let stopped = await Task { await session.shutdown() }.value
            guard !hasReplacementCapture else { restoreTLSConfiguration(session: session); releaseReservation(); return }
            guard stopped, !session.isActive, !session.isSystemProxyRoutingActive, !session.isSystemProxyRoutingRecoveryPending else {
                message += " Capture cleanup needs attention: \(session.message)"
                startReservationMonitor(session: session)
                return
            }
            session.routeThisMac = previousRoutingChoice
            restoreTLSConfiguration(session: session)
        }
        releaseReservation()
    }

    private func startReservationMonitor(session: any SimulatorCaptureSession) {
        monitor?.cancel()
        monitor = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if hasReplacementCapture {
                    restoreTLSConfiguration(session: session)
                    releaseReservation()
                    return
                }
                if !session.isActive, !session.isSystemProxyRoutingActive, !session.isSystemProxyRoutingRecoveryPending {
                    if ownsCapture {
                        session.routeThisMac = previousRoutingChoice
                        restoreTLSConfiguration(session: session)
                    }
                    releaseReservation()
                    return
                }
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            }
        }
    }

    private func markWorkingChecksFailed() {
        if engine == .working {
            engine = .failed
        }
        if routing == .working {
            routing = .failed
        }
        if certificate == .working {
            certificate = .failed
        }
        if https == .working {
            https = .failed
        }
        if delivery == .working {
            delivery = .failed
        }
    }

    private func failure(_ message: String) -> SimulatorSetupFailure {
        SimulatorSetupFailure(message: message)
    }
}
