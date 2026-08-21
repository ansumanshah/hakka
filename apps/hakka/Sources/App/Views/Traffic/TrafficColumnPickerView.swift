import SwiftUI

/// "Columns" popover for table display mode: toggle visibility, drag to
/// reorder. Deliberately its own explicit control rather than `Table`'s
/// built-in header-right-click picker — see `LiveTrafficTableView`'s doc
/// comment for why this app drives column state through its own tested
/// `TrafficColumnConfigStore` instead of `TableColumnCustomization`.
struct TrafficColumnPickerView: View {
    let store: TrafficColumnConfigStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Columns")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.top, 10)
            List {
                ForEach(store.columns) { entry in
                    Toggle(entry.column.title, isOn: visibilityBinding(for: entry.column))
                        .toggleStyle(.checkbox)
                        .font(.callout)
                }
                .onMove { offsets, destination in
                    store.move(fromOffsets: offsets, toOffset: destination)
                }
            }
            .listStyle(.plain)
            .frame(height: CGFloat(store.columns.count) * 26 + 8)
            Divider()
            Button("Reset to Default") { store.resetToDefault() }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(10)
        }
        .frame(width: 200)
    }

    private func visibilityBinding(for column: TrafficColumn) -> Binding<Bool> {
        Binding(
            get: { store.isVisible(column) },
            set: { store.setVisible($0, for: column) },
        )
    }
}
