import HakkaCommon
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
                    message: "\(model.traffic.requests.count) captured, none match this search.",
                )
            } else {
                List(selection: selectionBinding) {
                    ForEach(model.traffic.visibleRequests, id: \.id) { request in
                        LiveTrafficRowView(request: request)
                            .tag(request.id)
                            .contextMenu {
                                Button("Save to Collection") { model.saveCaptured(request) }
                                Button("Compare with Selected") {
                                    model.traffic.comparisonBaselineID = request.id
                                }
                                .disabled(!canCompare(with: request))
                            }
                    }
                }
                .listStyle(.plain)
            }
        }
        .sheet(isPresented: comparisonPresented) {
            if let pair = model.traffic.comparison {
                RequestDiffView(before: pair.before, after: pair.after) {
                    model.traffic.comparisonBaselineID = nil
                }
            }
        }
    }

    private var comparisonPresented: Binding<Bool> {
        Binding(
            get: { model.traffic.comparison != nil },
            set: { if !$0 { model.traffic.comparisonBaselineID = nil } },
        )
    }

    private var selectionBinding: Binding<String?> {
        Binding(get: { model.traffic.selectedRequestID }, set: { model.traffic.selectedRequestID = $0 })
    }

    /// Comparing needs a second, different row already selected.
    private func canCompare(with request: NetworkRequest) -> Bool {
        guard let selected = model.traffic.selectedRequestID else { return false }
        return selected != request.id
    }
}
