import HakkaCommon
import SwiftUI

/// The Storage surface: named device-storage snapshots (`"defaults"`,
/// `"keychain-redacted"`, `"cookies"`, ...) streamed over the `storage`
/// bridge frame kind. One disclosure group per store, entries as a plain
/// key/value list — snapshot-replace semantics mean this always shows the
/// latest state, never a history. Single-pane like `RulesView`/
/// `LogsPanelView` (no `DetailPaneView` counterpart).
struct StoragePanelView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            header
            if model.storage.stores.isEmpty {
                EmptyStateView(
                    systemImage: "externaldrive",
                    title: "No storage snapshots yet",
                    message: "Call HakkaInterceptor.shared.publishStorageSnapshot(store:entries:) on a connected device to see its storage here."
                )
            } else {
                StorageFilterBar(storage: model.storage)
                if model.storage.visibleStores.isEmpty {
                    EmptyStateView(
                        systemImage: "line.3.horizontal.decrease.circle",
                        title: "No matching entries",
                        message: emptyMessage
                    )
                } else {
                    storeList
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            Text("Storage")
                .font(.headline)
            Text(countText)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            Spacer()
            Button("Clear", role: .destructive) {
                model.storage.clear()
            }
            .disabled(model.storage.stores.isEmpty)
        }
        .padding(Spacing.lg)
    }

    /// Matches `LiveTrafficHeader.countText`'s "N of total" shape, counting
    /// stores (the row unit here) the same way that one counts requests.
    private var countText: String {
        let total = model.storage.stores.count
        let visible = model.storage.visibleStores.count
        return visible == total ? "\(total) stores" : "\(visible) of \(total)"
    }

    private var emptyMessage: String {
        let total = model.storage.stores.count
        if model.storage.selectedStore != nil, model.storage.searchText.isEmpty {
            return "\(total) stores captured, none match the selected store."
        }
        return "\(total) stores captured, none match this search."
    }

    private var storeList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.md) {
                ForEach(model.storage.visibleStores, id: \.store) { snapshot in
                    StorageStoreSection(snapshot: snapshot)
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.lg)
        }
    }
}
