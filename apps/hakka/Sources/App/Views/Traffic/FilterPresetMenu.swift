import SwiftUI

/// The traffic header's filter-preset menu: apply a saved search, save the
/// current one under a name, or delete saved presets.
struct FilterPresetMenu: View {
    let store: FilterPresetStore
    let currentQuery: String
    let apply: (String) -> Void

    @State private var isPresentingSave = false
    @State private var newName = ""

    var body: some View {
        Menu {
            ForEach(store.presets) { preset in
                Button(preset.name) {
                    apply(preset.query)
                }
            }
            if store.presets.isEmpty {
                Text("No saved filters")
            }
            Divider()
            Button("Save Current Filter…") {
                newName = ""
                isPresentingSave = true
            }
            .disabled(currentQuery.isEmpty)
            if !store.presets.isEmpty {
                Menu("Delete…") {
                    ForEach(store.presets) { preset in
                        Button(preset.name, role: .destructive) {
                            store.delete(preset)
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease.circle")
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Filter presets")
        .alert("Save Filter", isPresented: $isPresentingSave) {
            TextField("Name", text: $newName)
            Button("Save") {
                store.save(name: newName, query: currentQuery)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Saves the current search “\(currentQuery)” under this name.")
        }
    }
}
