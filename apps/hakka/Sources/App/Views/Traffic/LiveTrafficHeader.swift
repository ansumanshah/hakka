import SwiftUI

/// Connection status + count + Clear, over a search field — the traffic
/// list's toolbar.
struct LiveTrafficHeader: View {
    @Environment(AppModel.self) private var model
    @State private var presetStore = FilterPresetStore()
    @State private var columnPickerPresented = false
    @FocusState private var searchFieldFocused: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Circle()
                    .fill(model.traffic.isRunning ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(countText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                NoiseScopePill(
                    scope: model.traffic.noiseScope,
                    hiddenCount: model.traffic.hiddenByNoiseScopeCount,
                    hiddenErrorCount: model.traffic.hiddenNoiseScopeErrorCount,
                )
                displayModePicker
                Button("Clear") { Task { await model.traffic.clear() } }
                    .font(.caption)
                    .buttonStyle(.plain)
                    .disabled(model.traffic.requests.isEmpty)
            }
            searchField
        }
        .padding(10)
        // `AppCommands`' Cmd-F bumps this token; picking it up here (rather
        // than the command mutating `searchFieldFocused` directly) is the
        // only way a menu action — which has no view of this view's local
        // `@FocusState` — can still drive focus into it.
        .onChange(of: model.traffic.focusSearchToken) { _, _ in
            searchFieldFocused = true
        }
    }

    /// Table mode needs `TableColumnForEach` (macOS 14.4) — the package
    /// floor stays 14.0, so the toggle that offers it is gated the same way
    /// `LiveTrafficListView` gates rendering it. Never show an option that
    /// would just silently fall back to list underneath the user.
    @ViewBuilder
    private var displayModePicker: some View {
        if #available(macOS 14.4, *) {
            HStack(spacing: 2) {
                modeButton(.list, systemImage: "list.bullet")
                modeButton(.table, systemImage: "tablecells")
                if model.traffic.displayMode == .table {
                    Button {
                        columnPickerPresented = true
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                    }
                    .buttonStyle(.plain)
                    .help("Customize Columns")
                    .popover(isPresented: $columnPickerPresented) {
                        TrafficColumnPickerView(store: model.traffic.columnConfig)
                    }
                }
            }
            .font(.caption)
        }
    }

    private func modeButton(_ mode: TrafficDisplayMode, systemImage: String) -> some View {
        Button {
            model.traffic.displayMode = mode
        } label: {
            Image(systemName: systemImage)
                .foregroundStyle(model.traffic.displayMode == mode ? Color.accentColor : .secondary)
        }
        .buttonStyle(.plain)
        .help(mode == .list ? "List" : "Table")
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Search — try 2xx, method:POST, dur>100", text: searchBinding)
                .textFieldStyle(.plain)
                .font(.caption)
                .focused($searchFieldFocused)
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
            FilterPresetMenu(
                store: presetStore,
                currentQuery: model.traffic.searchText
            ) { query in
                model.traffic.searchText = query
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.traffic.searchText }, set: { model.traffic.searchText = $0 })
    }

    /// Shows the filtered count alongside the total, so a search that hides
    /// everything doesn't read as "nothing was captured".
    private var countText: String {
        let total = model.traffic.stats.count
        let visible = model.traffic.visibleRequests.count
        return visible == total ? "\(total) requests" : "\(visible) of \(total)"
    }

    private var statusText: String {
        // A file-operation message is transient and takes the foreground, but a
        // dead bridge is permanent, so it wins once the transient one clears.
        if let error = model.traffic.lastError { return error }
        if let error = model.traffic.startupError { return error }
        guard model.traffic.isRunning else { return "Starting…" }
        guard let port = model.traffic.boundPort else { return "Listening" }
        return "Listening on port \(port)"
    }
}
