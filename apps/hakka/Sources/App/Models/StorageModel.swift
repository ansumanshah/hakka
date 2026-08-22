import HakkaCommon
import HakkaServer
import Observation

/// The Storage surface's model: mirrors `BridgeHub.storageSnapshots` into a
/// per-store latest-snapshot map for the desktop Storage panel — the
/// sibling of `TrafficModel` for the `storage` frame kind.
///
/// Snapshot-replace semantics (see `StorageSnapshot`'s doc comment): a new
/// frame for a given `store` name replaces that store's entry outright, so
/// this only ever needs to remember the latest one per name, never a
/// history.
@MainActor
@Observable
final class StorageModel {
    private(set) var snapshotsByStore: [String: StorageSnapshot] = [:]

    /// Snapshots sorted by store name for stable list rendering.
    var stores: [StorageSnapshot] {
        snapshotsByStore.values.sorted { $0.store < $1.store }
    }

    /// Consumes `hub.storageSnapshots` for the lifetime of the calling
    /// task — meant to be driven by a SwiftUI `.task` at the app root,
    /// alongside `TrafficModel.start()`, not spawned as a detached `Task`.
    func start(hub: BridgeHub) async {
        for await snapshot in hub.storageSnapshots {
            snapshotsByStore[snapshot.store] = snapshot
        }
    }

    func clear() {
        snapshotsByStore = [:]
    }
}
