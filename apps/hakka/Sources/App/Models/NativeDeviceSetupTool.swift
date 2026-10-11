import Foundation
import HakkaCommon
import HakkaServer
import Security

/// AppModel owns this session; an MCP task ending does not orphan its listener.
@MainActor
final class ProxyDeviceSetupModel {
    private let server: ProxyDeviceSetupServer
    private var monitor: Task<Void, Never>?
    private var session: Session?
    private var isPreparing = false
    private var ownedCapture: ObjectIdentifier?
    private var previousRouting: (allowLAN: Bool, routeThisMac: Bool)?
    private struct Session {
        let capture: UUID
        let address: String
        let port: Int
        let expires: Date
        let started: Int64
        let existingIDs: Set<String>
        let fingerprint: String
        let nonce: String
        let link: String
        var testURL: String { "https://example.com/?hakka_device_setup=\(nonce)" }
    }

    init(server: ProxyDeviceSetupServer = ProxyDeviceSetupServer()) { self.server = server }

    func startCapture(address: String, proxy: ProxyCaptureModel, traffic: TrafficModel) async throws -> MCPToolResult {
        guard proxy.allowAgentControl else { throw ProxyDeviceSetupError.denied }
        guard !proxy.isActive, previousRouting == nil, !isPreparing,
              !proxy.isSystemProxyRoutingRecoveryPending, !proxy.isRecoveringSystemProxyRouting,
              traffic.isRunning, let bridgePort = traffic.boundPort else { throw ProxyDeviceSetupError.unavailable }
        guard ProxyDeviceAddress.activeAddresses().contains(address), !address.hasPrefix("127.") else { throw ProxyDeviceSetupError.invalidAddress }
        _ = try ProxyDeviceNetwork.load(directory: proxy.configurationDirectory)
        isPreparing = true
        defer { isPreparing = false }
        previousRouting = (proxy.allowLAN, proxy.routeThisMac)
        proxy.allowLAN = true
        proxy.routeThisMac = false
        proxy.start(bridgePort: bridgePort)
        ownedCapture = proxy.deviceSetupProcessIdentity
        for _ in 0..<150 {
            if proxy.state != .starting { break }
            do { try await Task.sleep(for: .milliseconds(100)) } catch { break }
        }
        guard proxy.state == .running, proxy.allowAgentControl else {
            _ = await stopOwnedCapture(proxy: proxy)
            throw ProxyDeviceSetupError.unavailable
        }
        return .json(.object(["state": .string("running"), "next": .string("Call proxy_device_setup with the same LAN address."), "captureOwnedByDeviceSetup": .bool(true)]))
    }

    func stopOwnedCapture(proxy: ProxyCaptureModel) async -> Bool {
        stop()
        guard previousRouting != nil else { return true }
        // A generation changes even when shutdown fails and leaves this same child running.
        // Only a different live child means another capture has taken ownership.
        if let current = proxy.deviceSetupProcessIdentity, current != ownedCapture {
            self.ownedCapture = nil; previousRouting = nil
            return true
        }
        // An unstructured task completes cleanup even if the initiating MCP call was cancelled.
        let shutdown = Task { @MainActor in await proxy.shutdown() }
        guard await shutdown.value else { return false }
        if let previousRouting {
            proxy.allowLAN = previousRouting.allowLAN
            proxy.routeThisMac = previousRouting.routeThisMac
        }
        self.ownedCapture = nil; previousRouting = nil
        return true
    }

    func prepare(address: String, proxy: ProxyCaptureModel, traffic: TrafficModel) async throws -> MCPToolResult {
        guard proxy.allowAgentControl else { throw ProxyDeviceSetupError.denied }
        guard !isPreparing else { throw ProxyDeviceSetupError.unavailable }
        isPreparing = true
        defer { isPreparing = false }
        guard proxy.state == .running, proxy.allowLAN, let path = proxy.certificatePath else {
            throw ProxyDeviceSetupError.unavailable
        }
        guard ProxyDeviceAddress.activeAddresses().contains(address), !address.hasPrefix("127.") else {
            throw ProxyDeviceSetupError.invalidAddress
        }
        let network = try ProxyDeviceNetwork.load(directory: proxy.configurationDirectory)
        let certificateFile = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
        defer { try? certificateFile.close() }
        let certificate = try certificateFile.read(upToCount: 65537) ?? Data()
        let profile = try ProxyDeviceProfile(publicPEM: certificate, network: network, address: address, port: proxy.port)
        let capture = proxy.deviceSetupCaptureIdentity, port = proxy.port
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw ProxyDeviceSetupError.unavailable }
        let nonce = bytes.map { String(format: "%02x", $0) }.joined()
        stop()
        let started = Int64(Date().timeIntervalSince1970 * 1000)
        let ids = Set(traffic.requests.map(\.id))
        let link = try await server.start(address: address, profile: profile.data, token: nonce, fingerprint: profile.fingerprint, testURL: "https://example.com/?hakka_device_setup=\(nonce)")
        guard proxy.deviceSetupCaptureIdentity == capture, proxy.state == .running, proxy.allowLAN, proxy.allowAgentControl,
              proxy.port == port, ProxyDeviceAddress.activeAddresses().contains(address) else {
            server.stop(); throw ProxyDeviceSetupError.unavailable
        }
        session = Session(capture: capture, address: address, port: port, expires: Date().addingTimeInterval(ProxyDeviceSetupServer.lifetime), started: started, existingIDs: ids, fingerprint: profile.fingerprint, nonce: nonce, link: link)
        monitor = Task { [weak self, weak proxy] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled, let self, let proxy else { return }
                self.validate(proxy)
                if self.session == nil { return }
            }
        }
        return ProxyDeviceSetupQRCode.append(to: status(proxy: proxy, traffic: traffic), link: link)
    }

    func stop() {
        monitor?.cancel(); monitor = nil; server.stop(); session = nil
    }

    private func validate(_ proxy: ProxyCaptureModel) {
        guard let session else { return }
        if Date() >= session.expires || proxy.state != .running || !proxy.allowLAN || !proxy.allowAgentControl ||
            proxy.deviceSetupCaptureIdentity != session.capture || proxy.port != session.port ||
            !ProxyDeviceAddress.activeAddresses().contains(session.address) { stop() }
    }

    func status(proxy: ProxyCaptureModel, traffic: TrafficModel) -> MCPToolResult {
        validate(proxy)
        guard let session, server.link != nil else {
            return .json(.object([
                "state": .string("inactive"), "profileMayRemainInstalled": .bool(true), "cleanup": .string(Self.cleanup),
                "availableAddresses": .array(ProxyDeviceAddress.activeAddresses().map(MCPValue.string)),
                "agentControlAllowed": .bool(proxy.allowAgentControl),
                "captureOwnedByDeviceSetup": .bool(previousRouting != nil),
                "networkConfigured": .bool((try? ProxyDeviceNetwork.load(directory: proxy.configurationDirectory)) != nil),
            ]))
        }
        let match = traffic.requests.first { request in
            Self.matches(request, url: session.testURL, started: session.started, existingIDs: session.existingIDs)
        }
        return .json(.object([
            "state": .string(match == nil ? "action_required" : "https_test_observed"),
            "setupLink": .string(session.link), "testLink": .string(session.testURL),
            "expiresAt": .string(ISO8601DateFormatter().string(from: session.expires)),
            "remainingSeconds": .number(max(0, session.expires.timeIntervalSinceNow)),
            "caSHA256": .string(session.fingerprint), "sourceIdentityVerified": .bool(false),
            "physicalDeviceVerified": .bool(false),
            "captureOwnedByDeviceSetup": .bool(previousRouting != nil),
            "instructions": .string("Open setupLink in iPhone Safari on the operator-prepared Wi-Fi. Download and install the removable profile in Settings → General → VPN & Device Management. Enable Full Trust for the imported CA (its certificate name may differ from the profile payload name) in Settings → General → About → Certificate Trust Settings. Enter Wi-Fi credentials on the phone if prompted, then open testLink. A captured nonce can originate elsewhere and does not prove a physical phone."),
            "matchedRequestID": match.map { .string($0.id) } ?? .null,
            "cleanup": .string(Self.cleanup),
        ]))
    }

    static func matches(_ request: NetworkRequest, url: String, started: Int64, existingIDs: Set<String>) -> Bool {
        !existingIDs.contains(request.id) && request.startTime >= started && request.url == url &&
            request.status.map { (200...299).contains($0) } == true && request.error == nil &&
            (request.responseBodySize > 0 || request.responseBody?.isEmpty == false)
    }

    static let cleanup = "Remove Hakka Temporary Device Setup in Settings → General → VPN & Device Management. Restore the previously recorded Wi-Fi proxy settings (choose Off only if it was originally Off) and remove or disable the imported CA trust if it remains. Stopping setup closes the temporary listener and stops only capture it started; device settings may remain."
}

struct NativeDeviceSetupTool: MCPTool {
    let name: String
    let description: String
    let inputSchema: MCPValue
    let action: @MainActor @Sendable (MCPValue) async -> MCPToolResult
    func call(_ arguments: MCPValue) async -> MCPToolResult { await action(arguments) }

    private static func failure(_ error: ProxyDeviceSetupError) -> MCPToolResult {
        .json(.object(["error": .string(error.errorDescription ?? "Device setup failed.")]), isError: true)
    }

    @MainActor static func tools(model: ProxyDeviceSetupModel, proxy: ProxyCaptureModel, traffic: TrafficModel) -> [any MCPTool] {
        func schema(address: Bool) -> MCPValue {
            .object(["type": .string("object"), "properties": .object(address ? ["address": .object(["type": .string("string")])] : [:]),
                     "required": .array(address ? [.string("address")] : []), "additionalProperties": .bool(false)])
        }
        return [
            Self(name: "proxy_device_capture_start", description: "Start this Mac’s existing native proxy owner for physical-device setup after validating the operator network file and exact active LAN IPv4 address. Requires Allow agents and a running desktop traffic bridge. Refuses any active capture; temporarily enables LAN without routing this Mac. Device setup stop shuts down only this owned capture and restores its prior routing choices.", inputSchema: schema(address: true)) { arguments in
                guard case let .object(values) = arguments, Set(values.keys) == ["address"], let address = values["address"]?.stringValue else { return Self.failure(.invalidArguments) }
                do { return try await model.startCapture(address: address, proxy: proxy, traffic: traffic) }
                catch { return .json(.object(["error": .string((error as? ProxyDeviceSetupError)?.errorDescription ?? "Device capture preparation failed.")]), isError: true) }
            },
            Self(name: "proxy_device_setup", description: "Prepare one removable iPhone Wi-Fi proxy/public CA profile and an eight-minute LAN setup page. Requires running LAN capture, Allow agents, operator-prepared private physical-device-network.json and an exact active LAN IPv4 address. Phone installation and full trust are required.", inputSchema: schema(address: true)) { arguments in
                guard case let .object(values) = arguments, Set(values.keys) == ["address"], let address = values["address"]?.stringValue else { return Self.failure(ProxyDeviceSetupError.invalidArguments) }
                do { return try await model.prepare(address: address, proxy: proxy, traffic: traffic) } catch { return .json(.object(["error": .string((error as? ProxyDeviceSetupError)?.errorDescription ?? "Device setup preparation failed.")]), isError: true) }
            },
            Self(name: "proxy_device_setup_status", description: "Read setup expiry and a newly captured successful HTTPS nonce response. The request source identity remains unverified.", inputSchema: schema(address: false)) { arguments in
                guard arguments == .object([:]) else { return Self.failure(ProxyDeviceSetupError.invalidArguments) }
                return model.status(proxy: proxy, traffic: traffic)
            },
            Self(name: "proxy_device_setup_stop", description: "Close the temporary setup listener and shut down only capture started by proxy_device_capture_start, restoring its prior routing choices after confirmed shutdown. Requires Allow agents. Device profiles may remain.", inputSchema: schema(address: false)) { arguments in
                guard arguments == .object([:]) else { return Self.failure(ProxyDeviceSetupError.invalidArguments) }
                guard proxy.allowAgentControl else { return Self.failure(ProxyDeviceSetupError.denied) }
                guard await model.stopOwnedCapture(proxy: proxy) else {
                    return .json(.object(["error": .string("Owned capture shutdown is unconfirmed; retry stop. Device profile may remain."), "cleanup": .string(ProxyDeviceSetupModel.cleanup)]), isError: true)
                }
                return .json(.object(["state": .string("inactive"), "profileMayRemainInstalled": .bool(true), "cleanup": .string(ProxyDeviceSetupModel.cleanup)]))
            },
        ]
    }
}
