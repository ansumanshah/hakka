import SwiftUI

/// Keeps search visible while secondary traffic actions share a compact menu.
struct LiveTrafficHeader: View {
    @Environment(AppModel.self) private var model
    @State private var presetStore = FilterPresetStore()
    @State private var columnPickerPresented = false
    @State private var statsPresented = false
    @FocusState private var searchFieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .top, spacing: Spacing.md) {
                statusIndicator
                Spacer(minLength: Spacing.sm)
                Text(countText)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .fixedSize()
            }
            HStack(spacing: Spacing.sm) {
                searchField
                Toggle("Errors only", isOn: errorsOnlyBinding)
                    .toggleStyle(.button)
                    .font(.caption)
                    .fixedSize()
                    .accessibilityHint("Shows only requests with a 4xx, 5xx, or transport error")
                actionsMenu
            }
            NoiseScopePill(
                scope: model.traffic.noiseScope,
                hiddenCount: model.traffic.hiddenByNoiseScopeCount,
                hiddenErrorCount: model.traffic.hiddenNoiseScopeErrorCount
            )
        }
        .padding(.horizontal, Layout.gutter)
        .padding(.vertical, Spacing.md)
        .onChange(of: model.traffic.focusSearchToken) { _, _ in
            searchFieldFocused = true
        }
    }

    private var statusIndicator: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            Image(systemName: model.traffic.startupError != nil ? "exclamationmark.triangle.fill" : "circle.fill")
                .font(.caption2)
                .foregroundStyle(model.traffic.isRunning ? ThemeTokens.Status.success : ThemeTokens.Status.warning)
                .accessibilityHidden(true)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(model.traffic.startupError != nil ? Color.primary : .secondary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
    }

    private var actionsMenu: some View {
        Menu {
            Picker("Display", selection: displayModeBinding) {
                Label("List", systemImage: "list.bullet").tag(TrafficDisplayMode.list)
                Label("Table", systemImage: "tablecells").tag(TrafficDisplayMode.table)
            }
            Button("Customize Columns…", systemImage: "slider.horizontal.3") {
                columnPickerPresented = true
            }
            .disabled(model.traffic.displayMode != .table)
            Button("Traffic Stats", systemImage: "chart.bar.xaxis") { statsPresented = true }
            Divider()
            Button("Clear Captured Traffic", systemImage: "trash") {
                Task { await model.traffic.clear() }
            }
            .disabled(model.traffic.requests.isEmpty)
        } label: {
            Label("Traffic options", systemImage: "ellipsis.circle")
                .labelStyle(.iconOnly)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .frame(width: ControlHeight.md, height: ControlHeight.md)
        .accessibilityLabel("Traffic options")
        .help("Display, stats, and clear traffic")
        .popover(isPresented: $statsPresented) {
            TrafficStatsPanelView(stats: model.traffic.stats)
        }
        .popover(isPresented: $columnPickerPresented) {
            TrafficColumnPickerView(store: model.traffic.columnConfig)
        }
    }

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Filter requests…", text: searchBinding)
                .textFieldStyle(.plain)
                .font(.callout)
                .focused($searchFieldFocused)
                .accessibilityLabel("Search traffic")
                .help("Search URLs or use filters such as method:POST, 4xx, or dur>100. Press Command-F to focus.")
            if !model.traffic.searchText.isEmpty {
                Button {
                    model.traffic.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Clear search")
            }
            FilterPresetMenu(store: presetStore, currentQuery: model.traffic.searchText) { query in
                model.traffic.searchText = query
            }
        }
        .padding(.horizontal, Spacing.md)
        .frame(height: ControlHeight.md)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: Radius.md))
        .frame(minWidth: 120, maxWidth: .infinity)
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.traffic.searchText }, set: { model.traffic.searchText = $0 })
    }

    private var errorsOnlyBinding: Binding<Bool> {
        Binding(get: { model.traffic.errorsOnly }, set: { model.traffic.errorsOnly = $0 })
    }

    private var displayModeBinding: Binding<TrafficDisplayMode> {
        Binding(get: { model.traffic.displayMode }, set: { model.traffic.displayMode = $0 })
    }

    private var countText: String {
        let total = model.traffic.stats.count
        let visible = model.traffic.visibleRequests.count
        return visible == total ? "\(total) requests" : "\(visible) of \(total)"
    }

    private var statusText: String {
        if let error = model.traffic.startupError {
            return error
        }
        if let error = model.traffic.lastError {
            return error
        }
        guard model.traffic.isRunning else { return "Starting the bridge…" }
        guard let port = model.traffic.boundPort else { return "Listening" }
        return "Listening on port \(port)"
    }
}
