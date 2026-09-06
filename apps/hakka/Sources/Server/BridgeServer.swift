import Foundation
import Network

/// Bonjour service type advertised for the desktop bridge hub. Must match
/// `NWBridgeHostBrowser.serviceType` (the existing iOS/macOS discovery
/// client) and `BRIDGE_MDNS_SERVICE_NAME` in
/// `packages/hakka-bridge/src/discovery.ts`.
public let bridgeBonjourServiceType = "_hakka._tcp"

/// Default WebSocket port — matches `DEFAULT_BRIDGE_PORT` in
/// `packages/hakka-bridge/src/server.ts` and every client's hardcoded
/// `ws://localhost:8989`.
public let bridgeDefaultPort: UInt16 = 8989

/// Startup configuration for `BridgeServer`.
public struct BridgeServerOptions: Sendable {
    public var port: UInt16
    /// `false` (default): bind loopback-only via `NWParameters.acceptLocalOnly`
    /// — nothing off-box can reach the hub, mirroring `server.ts`'s
    /// `127.0.0.1` default bind. `true` opts into LAN reachability for
    /// on-device debugging; only enable this on a trusted network, since
    /// this hub relays `control` frames that can rewrite live responses —
    /// see ADR 0002's bridge-hardening note
    /// (`docs/.../adr/0002-production-capture-cohort.md`).
    public var allowLAN: Bool
    /// Advertise `_hakka._tcp` via Bonjour. Only takes effect when
    /// `allowLAN` is also `true` — a loopback-only hub is unreachable from
    /// other devices regardless of mDNS, so advertising it would be
    /// actively misleading (mirrors `server.ts`'s `advertisable` gate).
    public var advertise: Bool
    /// Instance name shown to LAN browsers. Default: the machine's hostname.
    public var advertiseName: String?
    public var maxFrameBytes: Int
    /// Shared secret a peer must send as its first text frame
    /// (`{"token":"<value>"}`) before `BridgeConnection` registers it with
    /// `hub` — see `BridgeConnection.handleAssembledMessage`. `nil` (the
    /// default) means no token is required, matching `server.ts`'s
    /// `token`-unset default; origin checking has no Swift counterpart
    /// (Network.framework's `NWProtocolWebSocket` never exposes the
    /// upgrade request's headers to server code), so this token is the one
    /// gate available here. Defense in depth for when `allowLAN` is
    /// enabled — see `allowLAN`'s doc comment. Compared in constant time.
    public var token: String?

    public init(
        port: UInt16 = bridgeDefaultPort,
        allowLAN: Bool = false,
        advertise: Bool = true,
        advertiseName: String? = nil,
        maxFrameBytes: Int = BridgeWireLimits.maxFrameBytes,
        token: String? = nil
    ) {
        self.port = port
        self.allowLAN = allowLAN
        self.advertise = advertise
        self.advertiseName = advertiseName
        self.maxFrameBytes = maxFrameBytes
        self.token = token
    }
}

/// Owns the `NWListener` for the desktop bridge hub — the Network.framework
/// replacement for the Node `startBridgeServer` in
/// `packages/hakka-bridge/src/server.ts`. Accepts peer connections, wraps
/// each as a `BridgeConnection`, and (opt-in only) advertises `_hakka._tcp`
/// via Bonjour.
///
/// Most parsing/relay logic lives in `parseBridgeFrame`/`BridgeHub`, which are
/// unit-tested with injected fake peers and no socket. This actor used to be
/// described as the untestable shell around them, and that assumption cost:
/// the connection handler below dropped every peer it created, so the app
/// received nothing over a real socket while those fake-peer tests stayed
/// green. `BridgeSocketTests` now binds an ephemeral loopback port and drives
/// a real client through it. Anything that only holds together on a live
/// connection belongs in that suite.
public actor BridgeServer {
    public let hub: BridgeHub
    private let options: BridgeServerOptions
    private let queue = DispatchQueue(label: "com.noodleapps.hakka.desktop.bridge-server")
    private var listener: NWListener?
    private var listenerID: UUID?
    /// The port the listener reported after entering `.ready`. Keeping this
    /// separate from `NWListener.port` prevents the UI from treating a
    /// requested ephemeral port (`0`) as a live listener.
    public private(set) var boundPort: UInt16?

    public init(hub: BridgeHub = BridgeHub(), options: BridgeServerOptions = BridgeServerOptions()) {
        self.hub = hub
        self.options = options
    }

    public var isRunning: Bool { boundPort != nil }

    @discardableResult
    public func start() async throws -> UInt16 {
        try Task.checkCancellation()
        if listener != nil {
            guard let boundPort else { throw BridgeServerError.notBound }
            return boundPort
        }

        let wsOptions = NWProtocolWebSocket.Options()
        wsOptions.autoReplyPing = true
        wsOptions.maximumMessageSize = options.maxFrameBytes

        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        // Restricts accepted connections to same-host origin; does not change
        // which interfaces the socket binds. Node's equivalent is binding the
        // listen address itself to 127.0.0.1 — this is the Network.framework
        // idiom for the same guarantee at the connection-accept step.
        parameters.acceptLocalOnly = !options.allowLAN
        parameters.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)

        let port: NWEndpoint.Port = options.port == 0 ? .any : (NWEndpoint.Port(rawValue: options.port) ?? .any)
        let listener = try NWListener(using: parameters, on: port)

        if options.advertise, options.allowLAN {
            listener.service = NWListener.Service(
                name: options.advertiseName ?? ProcessInfo.processInfo.hostName,
                type: bridgeBonjourServiceType
            )
        }

        let id = UUID()
        let (readiness, continuation) = AsyncThrowingStream<Void, any Error>.makeStream()
        let hub = self.hub
        let maxFrameBytes = options.maxFrameBytes
        let requiredToken = options.token
        let connectionQueue = queue
        listener.newConnectionHandler = { connection in
            let peer = BridgeConnection(
                connection: connection, hub: hub, maxFrameBytes: maxFrameBytes, requiredToken: requiredToken,
            )
            peer.start(on: connectionQueue)
        }
        listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                continuation.yield(())
                continuation.finish()
            case let .failed(error), let .waiting(error):
                continuation.finish(throwing: error)
                Task { await self?.stop(ifCurrent: id) }
            case .cancelled:
                continuation.finish(throwing: CancellationError())
            default:
                break
            }
        }

        self.listener = listener
        listenerID = id
        listener.start(queue: queue)
        do {
            return try await withTaskCancellationHandler {
                for try await _ in readiness {
                    try Task.checkCancellation()
                    guard listenerID == id, let port = listener.port?.rawValue, port != 0 else {
                        throw BridgeServerError.notBound
                    }
                    boundPort = port
                    return port
                }
                try Task.checkCancellation()
                throw BridgeServerError.notBound
            } onCancel: {
                listener.cancel()
            }
        } catch {
            await stop(ifCurrent: id)
            throw error
        }
    }

    /// Stops accepting new connections AND disconnects every already-accepted
    /// one. `listener?.cancel()` alone only stops the listener — accepted
    /// `NWConnection`s are independent objects Network.framework keeps alive
    /// on their own, so without the `hub.closeAllPeers()` below, a device
    /// connected before `stop()` kept relaying frames through `hub`
    /// indefinitely even though `isRunning` had already gone `false`.
    public func stop() async {
        listener?.cancel()
        listener = nil
        listenerID = nil
        boundPort = nil
        await hub.closeAllPeers()
    }

    private func stop(ifCurrent id: UUID) async {
        guard listenerID == id else { return }
        await stop()
    }
}

public enum BridgeServerError: Error, Equatable {
    case notBound
}
