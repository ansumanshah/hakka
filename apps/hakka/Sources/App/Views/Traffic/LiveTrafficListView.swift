import HakkaCommon
import HakkaCore
import SwiftUI

/// Captured requests from every connected Hakka SDK, newest first. Selecting
/// a row drives `DetailPaneView`; "Save to Collection" is the capture →
/// collection promotion this app exists for.
struct LiveTrafficListView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            LiveTrafficHeader()
            Divider()
            if model.traffic.requests.isEmpty {
                EmptyStateView(
                    systemImage: "antenna.radiowaves.left.and.right",
                    title: "Waiting for traffic",
                    message: "Requests captured from a connected Hakka SDK appear here as they arrive.",
                )
            } else if model.traffic.visibleRequests.isEmpty {
                EmptyStateView(
                    systemImage: "line.3.horizontal.decrease.circle",
                    title: "No matching requests",
                    message: emptyMessage,
                )
            } else {
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
            }
        }
    }

    private var selectionBinding: Binding<String?> {
        Binding(get: { model.traffic.selectedRequestID }, set: { model.traffic.selectedRequestID = $0 })
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
