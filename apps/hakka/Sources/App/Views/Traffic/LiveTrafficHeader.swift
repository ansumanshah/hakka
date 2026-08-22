import SwiftUI

/// The traffic list's whole toolbar, collapsed into one `ControlHeight.bar`
/// (44pt) row rather than a status/count/actions row stacked over a second
/// search row — the design's unified-bar call, mirrored from the shipped
/// window toolbar's own "one 44pt bar, not two" rule (see `titlebar` in
/// `.claude/design/gen.py`). `ViewThatFits` decides between the full search
/// field and a collapsed search icon: at the app's normal window widths the
/// full bar fits outright, and only a genuinely narrow window (a small
/// split-screen tile) falls back to the icon, which expands back to the
/// full field on tap.
struct LiveTrafficHeader: View {
    @Environment(AppModel.self) private var model
    @State private var presetStore = FilterPresetStore()
    @State private var columnPickerPresented = false
    @State private var searchExpanded = false
    @FocusState private var searchFieldFocused: Bool

    var body: some View {
        ViewThatFits(in: .horizontal) {
            bar(collapsedSearch: false)
            bar(collapsedSearch: true)
        }
        .frame(height: ControlHeight.bar)
        .padding(.horizontal, Layout.gutter)
        // `AppCommands`' Cmd-F bumps this token; picking it up here (rather
        // than the command mutating `searchFieldFocused` directly) is the
        // only way a menu action — which has no view of this view's local
        // `@FocusState` — can still drive focus into it.
        .onChange(of: model.traffic.focusSearchToken) { _, _ in
            searchExpanded = true
            searchFieldFocused = true
        }
    }

    private func bar(collapsedSearch: Bool) -> some View {
        HStack(spacing: Spacing.md) {
            statusIndicator
            Text(countText)
                .font(.caption)
                .foregroundStyle(.secondary)
            if collapsedSearch, !searchExpanded {
                collapsedSearchButton
            } else {
                searchField
            }
            NoiseScopePill(
                scope: model.traffic.noiseScope,
                hiddenCount: model.traffic.hiddenByNoiseScopeCount,
                hiddenErrorCount: model.traffic.hiddenNoiseScopeErrorCount,
            )
            errorsOnlyToggle
            displayModePicker
            Button("Clear") { Task { await model.traffic.clear() } }
                .font(.caption)
                .buttonStyle(.plain)
                .disabled(model.traffic.requests.isEmpty)
        }
    }

    private var statusIndicator: some View {
        HStack(spacing: Spacing.sm) {
            Circle()
                .fill(model.traffic.isRunning ? Color.green : Color.red)
                .frame(width: 8, height: 8)  // ui-token-check-ignore: connection status dot
            Text(statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    /// A quick filter next to search rather than a search-syntax term
    /// (`status:>=400` already works via `TrafficQueryCompiler`) — the point
    /// is a one-click toggle for the most common scan, not another thing to
    /// type. Model-level in `TrafficModel.errorsOnly`, wired the same way
    /// `searchText` is, so it composes with search and the noise scope
    /// instead of fighting them (see `TrafficModel+NoiseScope.visibleRequests`).
    private var errorsOnlyToggle: some View {
        Toggle("Errors only", isOn: errorsOnlyBinding)
            .toggleStyle(.button)
            .font(.caption)
            .accessibilityHint("Shows only requests with a 4xx, 5xx, or transport error")
    }

    private var errorsOnlyBinding: Binding<Bool> {
        Binding(get: { model.traffic.errorsOnly }, set: { model.traffic.errorsOnly = $0 })
    }

    private var collapsedSearchButton: some View {
        Button {
            searchExpanded = true
            searchFieldFocused = true
        } label: {
            Image(systemName: "magnifyingglass")
        }
        .buttonStyle(.plain)
        .foregroundStyle(model.traffic.searchText.isEmpty ? Color.secondary : Color.accentColor)
        .help("Search")
        .accessibilityLabel("Expand search field")
    }

    /// Table mode needs `TableColumnForEach` (macOS 14.4) — the package
    /// floor stays 14.0, so the toggle that offers it is gated the same way
    /// `LiveTrafficListView` gates rendering it. Never show an option that
    /// would just silently fall back to list underneath the user.
    @ViewBuilder
    private var displayModePicker: some View {
        if #available(macOS 14.4, *) {
            HStack(spacing: Spacing.xxs) {
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
        HStack(spacing: Spacing.sm) {
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
        .padding(.horizontal, Spacing.md)
        .frame(height: ControlHeight.md)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: Radius.md))
        .frame(minWidth: 160, idealWidth: 320, maxWidth: .infinity)
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.traffic.searchText }, set: { model.traffic.searchText = $0 })
    }

    /// Shows the filtered count alongside the total, so a search — or the
    /// "Errors only" toggle — that hides everything doesn't read as
    /// "nothing was captured".
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
