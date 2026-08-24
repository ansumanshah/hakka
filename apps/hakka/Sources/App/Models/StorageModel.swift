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

    /// Every store name seen this session, sorted — the store picker's chip
    /// row. Independent of `searchText`/`selectedStore` so the picker itself
    /// never collapses just because a search hides every entry.
    var storeNames: [String] {
        snapshotsByStore.keys.sorted()
    }

    /// The store picker's current pick, nil for "All". A toggle like
    /// `TrafficModel.selectDevice`: picking the already-selected store
    /// clears back to "All" rather than re-selecting it.
    var selectedStore: String?

    /// Key/value search text, matched against both key and value,
    /// case-insensitively.
    var searchText = ""

    /// `stores` narrowed by `selectedStore` then `searchText` — the list the
    /// panel actually renders. A search that matches only some of a store's
    /// entries returns that store with just the matching entries (keeping
    /// its own `timestamp`), not the whole snapshot, so the count next to a
    /// filtered store reads honestly. Pure function of stored state, so
    /// `StorageModelFilterTests` exercises it directly, no view involved.
    var visibleStores: [StorageSnapshot] {
        var scoped = stores
        if let selectedStore { scoped = scoped.filter { $0.store == selectedStore } }
        let query = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return scoped }
        return scoped.compactMap { snapshot in
            let matchingEntries = snapshot.entries.filter { key, value in
                key.lowercased().contains(query) || value.lowercased().contains(query)
            }
            guard !matchingEntries.isEmpty else { return nil }
            return StorageSnapshot(store: snapshot.store, timestamp: snapshot.timestamp, entries: matchingEntries)
        }
    }

    /// Toggles the store picker's selection, same shape as
    /// `TrafficModel.selectDevice`: selecting the already-scoped store
    /// clears the filter instead of re-applying it.
    func selectStore(_ store: String) {
        selectedStore = selectedStore == store ? nil : store
    }

    /// Subscribes fresh to `hub`'s storage channel and consumes it for the
    /// lifetime of the calling task — meant to be driven by a SwiftUI
    /// `.task` at the app root, alongside `TrafficModel.start()`, not
    /// spawned as a detached `Task`.
    func start(hub: BridgeHub) async {
        for await snapshot in await hub.subscribeStorageSnapshots() {
            snapshotsByStore[snapshot.store] = snapshot
        }
    }

    func clear() {
        snapshotsByStore = [:]
        selectedStore = nil
    }

    /// Test-only seam: `start(hub:)` needs a live `BridgeHub`, so
    /// `StorageModelFilterTests` seeds snapshots directly instead — same
    /// shape as `TrafficModel.setBuffer`.
    func setSnapshots(_ snapshots: [StorageSnapshot]) {
        snapshotsByStore = Dictionary(uniqueKeysWithValues: snapshots.map { ($0.store, $0) })
    }
}
