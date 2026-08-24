import HakkaCommon
import HakkaServer

/// A `ConnectedDevice` plus the traffic tally the sidebar shows beside it.
/// Computed fresh on every read (see `TrafficModel.deviceSummaries`) rather
/// than maintained as running counters — the same on-read-not-cached shape
/// `searchMatchedRequests` already uses, and it makes `clear()` correct for
/// free: once `requests` empties, every device's tally reads zero without
/// anything needing to remember to reset it.
struct DeviceSummary: Identifiable {
    let device: ConnectedDevice
    let requestCount: Int
    let errorCount: Int
    var id: BridgePeerID { device.peerID }
}

/// Device connection state and per-device traffic tallies — split out of
/// `TrafficModel.swift` for the same 200-line reason as its other
/// extensions. Owns `devices`/`deviceIndexByPeer` (declared on the main type
/// only because an extension can't add a stored property).
extension TrafficModel {
    /// Which device produced `requestID`'s row, or nil for a request the
    /// bridge never attributed (e.g. one restored from an imported session).
    func deviceLabel(for requestID: String) -> BridgeDeviceLabel? {
        deviceIndex[requestID]
    }

    /// `devices`, each paired with how much of the current buffer belongs to
    /// it. Connection order, matching `devices` itself.
    var deviceSummaries: [DeviceSummary] {
        devices.map { device in
            guard let label = device.label else {
                return DeviceSummary(device: device, requestCount: 0, errorCount: 0)
            }
            var count = 0
            var errors = 0
            for request in requests where deviceIndex[request.id] == label {
                count += 1
                // Same "error" definition `stats.errorCount` uses
                // (`TrafficStatsAccumulator.isError`, internal to
                // HakkaCore) — a transport failure or any 4xx/5xx status —
                // so a device's tally reads consistently with the header's.
                if request.error != nil || (request.status.map { $0 >= 400 } ?? false) {
                    errors += 1
                }
            }
            return DeviceSummary(device: device, requestCount: count, errorCount: errors)
        }
    }

    /// Scopes the traffic list to `device` via the same `device:` search
    /// term `TrafficModelDeviceFilterTests` already exercises — no parallel
    /// filter mechanism. Selecting an already-scoped device clears the
    /// filter instead of re-applying it, so the sidebar row acts as a
    /// toggle. A no-op for a device with no label yet: there is nothing
    /// honest to filter by until one exists.
    func selectDevice(_ device: ConnectedDevice) {
        guard let label = device.label else { return }
        let term = "device:\(label)"
        searchText = searchText.trimmingCharacters(in: .whitespaces) == term ? "" : term
    }

    /// Subscribes fresh to `hub.subscribeDeviceEvents()` and consumes it for
    /// the lifetime of `start()`'s task group. `.connected` and
    /// `attributeToDevice` (called from
    /// `consumeRequests`) race each other — `BridgeConnection`'s own doc
    /// comment covers why `addPeer` and first-frame ingestion have no
    /// ordering guarantee between them — so both sides are written to be
    /// idempotent and to tolerate arriving in either order.
    func consumeDeviceEvents(hub: BridgeHub) async {
        for await event in await hub.subscribeDeviceEvents() {
            switch event {
            case let .connected(peerID):
                guard deviceIndexByPeer[peerID] == nil else { continue }
                deviceIndexByPeer[peerID] = devices.count
                devices.append(ConnectedDevice(peerID: peerID, label: nil, isConnected: true))
            case let .disconnected(peerID):
                guard let index = deviceIndexByPeer[peerID] else { continue }
                if devices[index].label == nil {
                    // Connected, sent nothing, gone — nothing to preserve,
                    // so this is the one case removed instead of marked
                    // disconnected (see `ConnectedDevice`'s doc comment).
                    devices.remove(at: index)
                    for i in index..<devices.count { deviceIndexByPeer[devices[i].peerID] = i }
                    deviceIndexByPeer.removeValue(forKey: peerID)
                } else {
                    devices[index].isConnected = false
                }
            }
        }
    }

    /// The only place a device gains its `BridgeDeviceLabel` — called from
    /// `consumeRequests` once a captured request's sender is known. Creates
    /// the device row if `.connected` hasn't been processed yet (the race
    /// this file's other doc comments describe); otherwise fills in the
    /// label on the row `.connected` already created, once, and never
    /// overwrites it — a label is permanent for a connection's lifetime.
    func attributeToDevice(peerID: BridgePeerID, label: BridgeDeviceLabel) {
        if let index = deviceIndexByPeer[peerID] {
            if devices[index].label == nil { devices[index].label = label }
        } else {
            deviceIndexByPeer[peerID] = devices.count
            devices.append(ConnectedDevice(peerID: peerID, label: label, isConnected: true))
        }
    }
}
