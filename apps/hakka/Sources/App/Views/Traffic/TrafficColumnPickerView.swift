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

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var headerName = ""
    @State private var headerSource: TrafficHeaderSource = .response

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
            headerColumnsControls
            Divider()
            Button("Reset to Default") { store.resetToDefault() }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(Spacing.ml)
        }
        .frame(width: 290)
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
                    // One glyph, flipped by rotation rather than swapped between
                    // "arrow.up"/"arrow.down" — a 180° rotation of the up arrow
                    // reads as the down arrow, so this is the same visual with a
                    // real interpolatable property `.animation(value:)` can
                    // actually tween, matching the toggle grammar the method/
                    // status chips use.
                    Image(systemName: "arrow.up")
                        .rotationEffect(.degrees(sortOrder == .asc ? 0 : 180))
                }
                .buttonStyle(.plain)
                .disabled(sortFieldRaw.isEmpty)
                .help(sortOrder == .asc ? "Ascending" : "Descending")
                .accessibilityLabel(sortOrder == .asc ? "Sort ascending" : "Sort descending")
                .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 0.9), value: sortOrder)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.top, Spacing.ml)
        .padding(.bottom, Spacing.sm)
    }

    private var sortOrder: TrafficSortOrder {
        TrafficSortOrder(rawValue: sortOrderRaw) ?? .desc
    }

    private var headerColumnsControls: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Header Columns")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            HStack(spacing: Spacing.xs) {
                Picker("Header source", selection: $headerSource) {
                    ForEach(TrafficHeaderSource.allCases) { source in
                        Text(source.title).tag(source)
                    }
                }
                .labelsHidden()
                .pickerStyle(.segmented)

                TextField("Header name", text: $headerName)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Header name")
                    .onSubmit(addHeaderColumn)

                Button(action: addHeaderColumn) {
                    Image(systemName: "plus")
                }
                .disabled(!TrafficColumnConfigStore.isValidHeaderName(headerName.trimmingCharacters(in: .whitespacesAndNewlines)))
                .accessibilityLabel("Add header column")
                .help("Add header column")
            }

            if store.headerColumns.isEmpty {
                Text("Add a request or response header to show its value in the table.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Spacing.sm) {
                        ForEach(store.headerColumns) { column in
                            HStack(spacing: Spacing.sm) {
                                Text(column.title)
                                    .font(.caption.monospaced())
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Spacer(minLength: 0)
                                Button {
                                    store.removeHeaderColumn(column)
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Remove \(column.title) column")
                                .help("Remove \(column.title) column")
                            }
                        }
                    }
                }
                .frame(maxHeight: ControlHeight.md * 5)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.ml)
    }

    private func addHeaderColumn() {
        guard store.addHeaderColumn(named: headerName, source: headerSource) != nil else { return }
        headerName = ""
    }

    private func visibilityBinding(for column: TrafficColumn) -> Binding<Bool> {
        Binding(
            get: { store.isVisible(column) },
            set: { store.setVisible($0, for: column) }
        )
    }
}
