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
            } else {
                List(selection: selectionBinding) {
                    ForEach(model.traffic.requests.reversed(), id: \.id) { request in
                        LiveTrafficRowView(request: request)
                            .tag(request.id)
                            .contextMenu {
                                Button("Save to Collection") { model.saveCaptured(request) }
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
}
