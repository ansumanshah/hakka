import SwiftUI

/// Search snapshots by key or value and scope them to a named store.
struct StorageFilterBar: View {
    @Environment(AppModel.self) private var model
    @Bindable var storage: StorageModel

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            searchField
            if storage.storeNames.count > 1 {
                storePicker
            }
        }
        .padding(.horizontal, Layout.gutter)
        .padding(.bottom, Spacing.md)
    }

    private var searchField: some View {
        WorkspaceSearchField(
            prompt: "Search keys and values",
            accessibilityName: "Search storage",
            text: $storage.searchText,
            focusToken: model.workspaceSearchFocusToken,
            helpText: "Press Command-F to search this workspace."
        )
    }

    /// Only shown once a second store has actually arrived (see `body`) — a
    /// device reporting just `"defaults"` has nothing worth picking between,
    /// so the row would be a single always-active chip for no reason.
    private var storePicker: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            HStack(spacing: Spacing.sm) {
                WorkspaceFilterChip(title: "All stores", isSelected: storage.selectedStore == nil) {
                    storage.selectedStore = nil
                }
                ForEach(storage.storeNames, id: \.self) { store in
                    storeChip(store)
                }
            }
        }
    }

    private func storeChip(_ store: String) -> some View {
        WorkspaceFilterChip(title: store, isSelected: storage.selectedStore == store) {
            storage.selectStore(store)
        }
        .accessibilityLabel("\(store) store filter")
    }
}
