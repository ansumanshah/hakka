import HakkaCore
import SwiftUI

/// "Columns" popover for table display mode: toggle visibility, drag to
/// reorder, plus Group By / Sort By controls for the same table. Deliberately
/// its own explicit control rather than `Table`'s built-in header-right-click
/// picker — see `LiveTrafficTableView`'s doc comment for why this app drives
/// column state through its own tested `TrafficColumnConfigStore` instead of
/// `TableColumnCustomization`.
///
/// Group By and Sort By are `@AppStorage`, not routed through a store type
/// like `columns` above: `LiveTrafficTableView` needs to read the exact same
/// live value from an entirely separate view (this popover's content), and
/// `@AppStorage` is what keeps two unrelated views in sync with one
/// persisted preference — the shared `UserDefaults` key both read is the
/// only wiring, no object has to be threaded between them.
struct TrafficColumnPickerView: View {
    let store: TrafficColumnConfigStore

    static let groupByKey = "hakka.traffic.table.groupBy"
    static let sortFieldKey = "hakka.traffic.table.sortField"
    static let sortOrderKey = "hakka.traffic.table.sortOrder"

    @AppStorage(Self.groupByKey) private var groupByRaw = TrafficGroupBy.none.rawValue
    /// Empty means "no override" — the table shows whatever order
    /// `visibleRequests` already produced (search DSL `sort:`, or
    /// newest-first). A concrete field always wins once chosen; there is no
    /// UI path back to "unset" other than picking "Default" again.
    @AppStorage(Self.sortFieldKey) private var sortFieldRaw = ""
    @AppStorage(Self.sortOrderKey) private var sortOrderRaw = TrafficSortOrder.desc.rawValue

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            groupAndSortControls
            Divider()
            Text("Columns")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.ml)
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
                .padding(Spacing.ml)
        }
        .frame(width: 200)
    }

    private var groupAndSortControls: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Group By")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Picker("Group By", selection: $groupByRaw) {
                ForEach(TrafficGroupBy.allCases) { Text($0.title).tag($0.rawValue) }
            }
            .labelsHidden()
            .pickerStyle(.menu)

            Text("Sort By")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(spacing: Spacing.xs) {
                Picker("Sort By", selection: $sortFieldRaw) {
                    Text("Default").tag("")
                    ForEach(TrafficSortField.allCases) { Text($0.title).tag($0.rawValue) }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                Button {
                    sortOrderRaw = (sortOrder == .asc ? TrafficSortOrder.desc : .asc).rawValue
                } label: {
                    Image(systemName: sortOrder == .asc ? "arrow.up" : "arrow.down")
                }
                .buttonStyle(.plain)
                .disabled(sortFieldRaw.isEmpty)
                .help(sortOrder == .asc ? "Ascending" : "Descending")
                .accessibilityLabel(sortOrder == .asc ? "Sort ascending" : "Sort descending")
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.top, Spacing.ml)
        .padding(.bottom, Spacing.sm)
    }

    private var sortOrder: TrafficSortOrder { TrafficSortOrder(rawValue: sortOrderRaw) ?? .desc }

    private func visibilityBinding(for column: TrafficColumn) -> Binding<Bool> {
        Binding(
            get: { store.isVisible(column) },
            set: { store.setVisible($0, for: column) },
        )
    }
}
