import HakkaCommon
import HakkaCore
import SwiftUI

/// Captured requests from every connected Hakka SDK, newest first. Selecting
/// a row drives `DetailPaneView`; "Save to Collection" is the capture →
/// collection promotion this app exists for.
struct LiveTrafficListView: View {
    @Environment(AppModel.self) private var model
    /// So arrow keys move the selection the moment this pane appears,
    /// rather than only after the user clicks a row once to give the list
    /// keyboard focus — reading traffic is a keyboard-first scan loop.
    @FocusState private var listFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            LiveTrafficHeader()
            Divider()
            TrafficFilterChipsView(searchText: searchBinding)
                .padding(.horizontal, Layout.gutter)
                .padding(.vertical, Spacing.sm)
            if model.traffic.requests.isEmpty {
                // First-run only (Artboard 6): once traffic has ever
                // arrived, a later cleared list stays the generic state —
                // see `TrafficModel.hasEverReceivedTraffic`'s doc comment.
                if model.traffic.hasEverReceivedTraffic {
                    EmptyStateView(
                        systemImage: "antenna.radiowaves.left.and.right",
                        title: "Waiting for traffic",
                        message: "Requests captured from a connected Hakka SDK appear here as they arrive.",
                    )
                } else {
                    FirstRunEmptyView()
                }
            } else if model.traffic.visibleRequests.isEmpty {
                EmptyStateView(
                    systemImage: "line.3.horizontal.decrease.circle",
                    title: "No matching requests",
                    message: emptyMessage,
                )
            } else if model.traffic.displayMode == .table, #available(macOS 14.4, *) {
                LiveTrafficTableView()
            } else {
                // Table mode's `TableColumnForEach` needs macOS 14.4; the
                // package floor stays 14.0 (a deployment-target bump is a
                // business call the owner hasn't made, not something a
                // column-resize affordance gets to force), so a 14.0-14.3
                // user — or `displayMode` persisted as `.table` from a
                // newer machine — falls back here instead of losing the
                // pane. List mode is the default and loses nothing.
                listView
            }
        }
    }

    private var listView: some View {
        List(selection: selectionBinding) {
            ForEach(model.traffic.visibleRequests, id: \.id) { request in
                LiveTrafficRowView(request: request, deviceLabel: model.traffic.deviceLabel(for: request.id))
                    .tag(request.id)
                    .contextMenu {
                        Button("Save to Collection") { model.saveCaptured(request) }
                        Button("Compare with Selected") {
                            model.traffic.comparisonBaselineID = request.id
                        }
                        .disabled(!canCompare(with: request))
                        Divider()
                        Button(noiseMenuTitle(for: request)) { toggleMute(request) }
                    }
            }
        }
        .listStyle(.plain)
        .focused($listFocused)
        .onAppear { seedSelectionIfNeeded() }
        .onChange(of: model.traffic.visibleRequests.map(\.id)) { _, _ in seedSelectionIfNeeded() }
        .task { listFocused = true }
    }

    /// Up/Down only moves an *existing* selection — with none set, the
    /// first arrow press would otherwise do nothing. Pre-selecting the
    /// newest row (the list's first, since it's newest-first) means arrow
    /// keys work the instant the pane appears, same as Mail's message list.
    private func seedSelectionIfNeeded() {
        guard model.traffic.selectedRequestID == nil,
              let first = model.traffic.visibleRequests.first
        else { return }
        model.traffic.selectedRequestID = first.id
    }

    private var selectionBinding: Binding<String?> {
        Binding(get: { model.traffic.selectedRequestID }, set: { model.traffic.selectedRequestID = $0 })
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.traffic.searchText }, set: { model.traffic.searchText = $0 })
    }

    /// Comparing needs a second, different row already selected.
    private func canCompare(with request: NetworkRequest) -> Bool {
        guard let selected = model.traffic.selectedRequestID else { return false }
        return selected != request.id
    }

    /// "Mute this host" from the row context menu — the point where a
    /// developer actually notices the noise, per the competitive-UX finding
    /// this scope model exists to answer. Toggles rather than always
    /// muting, so the same menu item un-mutes a host once quieted.
    private func toggleMute(_ request: NetworkRequest) {
        let host = TrafficQueryCompiler.requestHost(request).lowercased()
        if let existing = model.traffic.noiseScope.excludeRules.first(where: { $0.host == host }) {
            model.traffic.noiseScope.unmute(existing)
        } else {
            model.traffic.noiseScope.mute(host: host)
        }
    }

    private func noiseMenuTitle(for request: NetworkRequest) -> String {
        let host = TrafficQueryCompiler.requestHost(request)
        let isMuted = model.traffic.noiseScope.excludeRules.contains { $0.host == host.lowercased() }
        return isMuted ? "Unmute \(host)" : "Mute \(host)"
    }

    /// Distinguishes "the search hides everything" from "the noise scope
    /// hides everything" — the latter isn't a search problem, so telling the
    /// developer to widen their search would be the wrong nudge.
    private var emptyMessage: String {
        let total = model.traffic.requests.count
        let searchIsEmpty = model.traffic.searchText.trimmingCharacters(in: .whitespaces).isEmpty
        if searchIsEmpty, model.traffic.noiseScope.isActive {
            return "\(total) captured, all hidden by the current noise scope."
        }
        return "\(total) captured, none match this search."
    }
}
