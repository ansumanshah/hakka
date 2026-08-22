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
                storeList
            }
        }
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            Text("Storage")
                .font(.headline)
            Text("\(model.storage.stores.count)")
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

    private var storeList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.md) {
                ForEach(model.storage.stores, id: \.store) { snapshot in
                    StorageStoreSection(snapshot: snapshot)
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.lg)
        }
    }
}

/// One store's snapshot: name, entry count, last-updated time, and its
/// key/value entries in a disclosure group — collapsed by default so a
/// device with several stores (defaults, keychain, cookies) doesn't dump
/// every value on screen at once.
private struct StorageStoreSection: View {
    let snapshot: StorageSnapshot
    @State private var isExpanded = true

    private var sortedEntries: [(key: String, value: String)] {
        snapshot.entries.sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
    }

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            if sortedEntries.isEmpty {
                Text("No entries")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.top, Spacing.xs)
            } else {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    ForEach(sortedEntries, id: \.key) { entry in
                        StorageEntryRow(key: entry.key, value: entry.value)
                    }
                }
                .padding(.top, Spacing.xs)
            }
        } label: {
            HStack(spacing: Spacing.md) {
                Text(snapshot.store)
                    .font(.subheadline.weight(.semibold))
                Text("\(snapshot.entries.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
                Text(Fmt.time(snapshot.timestamp))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(Spacing.lg)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
    }
}

private struct StorageEntryRow: View {
    let key: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Text(key)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(minWidth: 120, alignment: .leading)
            Text(value)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
