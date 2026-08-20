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

    public init(
        port: UInt16 = bridgeDefaultPort,
        allowLAN: Bool = false,
        advertise: Bool = true,
        advertiseName: String? = nil,
        maxFrameBytes: Int = BridgeWireLimits.maxFrameBytes
    ) {
        self.port = port
        self.allowLAN = allowLAN
        self.advertise = advertise
        self.advertiseName = advertiseName
        self.maxFrameBytes = maxFrameBytes
    }
}

/// Owns the `NWListener` for the desktop bridge hub — the Network.framework
/// replacement for the Node `startBridgeServer` in
/// `packages/hakka-bridge/src/server.ts`. Accepts peer connections, wraps
/// each as a `BridgeConnection`, and (opt-in only) advertises `_hakka._tcp`
/// via Bonjour.
///
/// All parsing/relay logic lives in `parseBridgeFrame`/`BridgeHub`, which are
/// unit-tested without a real socket; this actor is the thin,
/// largely-untestable networking shell around them — see `ServerTests.swift`
/// for why real ports are never bound in tests.
public actor BridgeServer {
    public let hub: BridgeHub
    private let options: BridgeServerOptions
    private let queue = DispatchQueue(label: "com.noodleapps.hakka.desktop.bridge-server")
    private var listener: NWListener?

    public init(hub: BridgeHub = BridgeHub(), options: BridgeServerOptions = BridgeServerOptions()) {
        self.hub = hub
        self.options = options
    }

    public var isRunning: Bool { listener != nil }

    /// The actually-bound port — resolved even when `options.port == 0`
    /// requested an ephemeral one.
    public var boundPort: UInt16? { listener?.port?.rawValue }

    public func start() throws {
        guard listener == nil else { return }

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

        let hub = self.hub
        let maxFrameBytes = options.maxFrameBytes
        let connectionQueue = queue
        listener.newConnectionHandler = { connection in
            let peer = BridgeConnection(connection: connection, hub: hub, maxFrameBytes: maxFrameBytes)
            peer.start(on: connectionQueue)
        }

        listener.start(queue: queue)
        self.listener = listener
    }

    public func stop() {
        listener?.cancel()
        listener = nil
    }
}
