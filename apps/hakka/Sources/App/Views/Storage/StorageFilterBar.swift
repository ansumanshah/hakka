import SwiftUI

/// Store picker chips + key/value search over `StorageModel`'s
/// `selectedStore`/`searchText` — same capsule-chip idiom as
/// `LogsFilterBar.levelChip` and the same toggle-to-clear selection as
/// `TrafficModel.selectDevice`. Split out of `StoragePanelView.swift` to
/// hold the 200-line budget.
struct StorageFilterBar: View {
    @Bindable var storage: StorageModel

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            searchField
            if storage.storeNames.count > 1 {
                storePicker
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.md)
    }

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Search keys and values", text: $storage.searchText)
                .textFieldStyle(.plain)
                .font(.caption)
            if !storage.searchText.isEmpty {
                Button {
                    storage.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: Radius.md))
    }

    /// Only shown once a second store has actually arrived (see `body`) — a
    /// device reporting just `"defaults"` has nothing worth picking between,
    /// so the row would be a single always-active chip for no reason.
    private var storePicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(storage.storeNames, id: \.self) { store in
                    storeChip(store)
                }
            }
        }
    }

    private func storeChip(_ store: String) -> some View {
        let isActive = storage.selectedStore == store
        return Button {
            storage.selectStore(store)
        } label: {
            Text(store)
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, Spacing.sm)
                .padding(.vertical, Spacing.xs)
                .background(isActive ? Color.accentColor.opacity(0.2) : Color.secondary.opacity(0.08), in: Capsule())
                .foregroundStyle(isActive ? Color.accentColor : .secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(store) store filter")
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}
