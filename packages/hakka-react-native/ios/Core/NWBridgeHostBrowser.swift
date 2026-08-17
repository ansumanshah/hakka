// @generated — do not edit. Synced from ios/Sources/Common/NWBridgeHostBrowser.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation
import Network

// MARK: - NWBridgeHostBrowser

/// `NWBrowser`-backed `BridgeHostBrowsing` for the Hakka bridge hub's `_hakka._tcp`
/// Bonjour/mDNS advertisement.
///
/// `NWBrowser` only yields an opaque `.service` endpoint, not a connectable address, so
/// each discovered endpoint is resolved by briefly opening (and immediately cancelling
/// once `.ready`) a TCP probe connection and reading its resolved `currentPath.remoteEndpoint`.
///
/// Not unit-tested directly — real Bonjour/mDNS requires a live network and OS-level
/// permissions (Local Network usage description + `NSBonjourServices` in the host app's
/// Info.plist), which is unreliable in CI. `HakkaBridgeDiscoveryTests` covers the
/// selection semantics (0/1/many) against a faked `BridgeHostBrowsing`.
public final class NWBridgeHostBrowser: BridgeHostBrowsing, @unchecked Sendable {
    /// Must match the hub's advertised type in `packages/hakka-bridge/src/discovery.ts`.
    static let serviceType = "_hakka._tcp"

    /// Max time to wait for a probe connection to resolve before giving up on it and
    /// cancelling it — without this, a probe stuck in `.preparing`/`.waiting` (never
    /// reaching `.ready`/`.failed`/`.cancelled`) would keep its socket open indefinitely.
    private static let probeTimeout: TimeInterval = 5

    private let queue = DispatchQueue(label: "com.noodleapps.hakka.bridge-discovery.nwbrowser")
    private var browser: NWBrowser?
    /// Retains in-flight probe connections (keyed by identity) so ``stop()`` can cancel
    /// them — without this, a probe still pending when discovery stops keeps its socket
    /// open even though nothing observes its result anymore.
    private var probes: [ObjectIdentifier: NWConnection] = [:]
    private var hostsByEndpoint: [NWEndpoint: DiscoveredBridgeHost] = [:]
    private var onHostsChanged: (@Sendable ([DiscoveredBridgeHost]) -> Void)?

    public init() {}

    // MARK: - BridgeHostBrowsing

    public func start(onHostsChanged: @escaping @Sendable ([DiscoveredBridgeHost]) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            self.onHostsChanged = onHostsChanged
            self.startBrowsing()
        }
    }

    public func stop() {
        queue.async { [weak self] in
            guard let self else { return }
            self.browser?.cancel()
            self.browser = nil
            self.hostsByEndpoint.removeAll()
            for connection in self.probes.values {
                connection.cancel()
            }
            self.probes.removeAll()
        }
    }

    // MARK: - Private

    private func startBrowsing() {
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = true
        let browser = NWBrowser(for: .bonjour(type: Self.serviceType, domain: ""), using: parameters)

        browser.browseResultsChangedHandler = { [weak self] _, changes in
            guard let self else { return }
            self.queue.async {
                for change in changes {
                    switch change {
                    case .added(let result):
                        self.resolve(result.endpoint)
                    case .removed(let result):
                        self.hostsByEndpoint.removeValue(forKey: result.endpoint)
                        self.emit()
                    default:
                        break
                    }
                }
            }
        }

        self.browser = browser
        browser.start(queue: queue)
    }

    /// Opens a short-lived TCP probe connection purely to resolve `endpoint` to a
    /// connectable host/port pair, then cancels it — the real traffic goes over a
    /// separate `HakkaBridgeClient` WebSocket once a host is selected.
    private func resolve(_ endpoint: NWEndpoint) {
        let connection = NWConnection(to: endpoint, using: .tcp)
        let id = ObjectIdentifier(connection)
        probes[id] = connection

        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.queue.async {
                    if case .hostPort(let host, let port) = connection.currentPath?.remoteEndpoint {
                        self.hostsByEndpoint[endpoint] = DiscoveredBridgeHost(
                            hostname: "\(host)",
                            port: Int(port.rawValue)
                        )
                        self.emit()
                    }
                    connection.cancel()
                }
            case .failed, .cancelled:
                self.queue.async {
                    self.probes.removeValue(forKey: id)
                }
            default:
                break
            }
        }
        connection.start(queue: queue)

        queue.asyncAfter(deadline: .now() + Self.probeTimeout) { [weak self] in
            guard let self, self.probes[id] != nil else { return }
            connection.cancel()
        }
    }

    private func emit() {
        onHostsChanged?(Array(hostsByEndpoint.values))
    }
}
