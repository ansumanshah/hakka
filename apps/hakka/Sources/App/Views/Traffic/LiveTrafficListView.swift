import HakkaCommon
import HakkaCore
import SwiftUI

/// Captured requests from every connected Hakka SDK, newest first. Selecting
/// a row drives `DetailPaneView`; "Save to Collection" is the capture →
/// collection promotion this app exists for.
struct LiveTrafficListView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var savedViewStore = TrafficSavedViewStore()
    /// So arrow keys move the selection the moment this pane appears,
    /// rather than only after the user clicks a row once to give the list
    /// keyboard focus — reading traffic is a keyboard-first scan loop.
    @FocusState private var listFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            LiveTrafficHeader(
                savedViewStore: savedViewStore,
                query: searchBinding,
                selectedRequestID: selectionBinding
            )
            Divider()
            if model.traffic.requests.isEmpty {
                // First-run only (Artboard 6): once traffic has ever
                // arrived, a later cleared list stays the generic state —
                // see `TrafficModel.hasEverReceivedTraffic`'s doc comment.
                if model.traffic.hasEverReceivedTraffic {
                    EmptyStateView(
                        systemImage: "antenna.radiowaves.left.and.right",
                        title: "Waiting for traffic",
                        message: "Requests captured from a connected Hakka SDK appear here as they arrive."
                    )
                    .transition(.opacity)
                } else {
                    FirstRunEmptyView()
                        .transition(.opacity)
                }
            } else if model.traffic.visibleRequests.isEmpty {
                noMatchesView
                    .transition(.opacity)
            } else if model.traffic.displayMode == .table {
                LiveTrafficTableView()
                    .transition(.opacity)
            } else {
                listView
                    .transition(.opacity)
            }
            Divider()
            TrafficStatusBar(
                stats: model.traffic.stats,
                visibleCount: model.traffic.visibleRequests.count
            )
        }
        .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.85), value: listRevealKey)
        .onChange(of: model.traffic.searchText) { _, query in
            savedViewStore.updateActive(query: query, selectedRequestID: model.traffic.selectedRequestID)
        }
        .onChange(of: model.traffic.selectedRequestID) { _, selectedRequestID in
            savedViewStore.updateActive(query: model.traffic.searchText, selectedRequestID: selectedRequestID)
        }
    }

    /// Crossfade trigger for the branch above — empty, no-match, or the
    /// populated list/table — deliberately never keyed on `visibleRequests`
    /// itself. That array's contents churn continuously as traffic streams
    /// in; animating on every element change would be exactly the per-row
    /// hot-path case `swiftui-patterns.md` rules out. This only flips when a
    /// request count crosses the empty/populated boundary, a search narrows
    /// to zero matches, or the display mode changes — bounded, user-driven
    /// moments, not live traffic.
    private struct ListRevealKey: Equatable {
        let hasRequests: Bool
        let hasEverReceivedTraffic: Bool
        let hasVisibleRequests: Bool
        let displayMode: TrafficDisplayMode
    }

    private var listRevealKey: ListRevealKey {
        ListRevealKey(
            hasRequests: !model.traffic.requests.isEmpty,
            hasEverReceivedTraffic: model.traffic.hasEverReceivedTraffic,
            hasVisibleRequests: !model.traffic.visibleRequests.isEmpty,
            displayMode: model.traffic.displayMode
        )
    }

    private var listView: some View {
        List(selection: selectionBinding) {
            ForEach(model.traffic.visibleRequests, id: \.id) { request in
                LiveTrafficRowView(request: request, deviceLabel: model.traffic.deviceLabel(for: request.id), isSelected: model.traffic.selectedRequestID == request.id)
                    .tag(request.id)
                    .listRowInsets(EdgeInsets(top: 0, leading: Layout.gutter, bottom: 0, trailing: Layout.gutter))
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
        .scrollContentBackground(.hidden)
        .background(Color(nsColor: .textBackgroundColor))
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

    private var noMatchesView: some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("No matching requests")
                .font(.headline)
            Text("\(model.traffic.requests.count) captured requests are hidden by the current filters.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Reset Filters") {
                model.traffic.searchText = ""
                model.traffic.errorsOnly = false
                model.traffic.noiseScope.clear()
            }
            .buttonStyle(.bordered)
        }
        .padding(Layout.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .chromeMaterial(.panel)
    }
}
