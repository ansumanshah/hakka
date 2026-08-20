import SwiftUI

/// Right column: the active request's last response, or the selected
/// captured-traffic row's record — both render through the same
/// `NetworkRequestDetailView` since both are a `NetworkRequest`.
struct DetailPaneView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.selection {
        case .request:
            requestDetail
        case .traffic:
            trafficDetail
        case nil:
            EmptyStateView(systemImage: "doc.text.magnifyingglass", title: "Nothing selected")
        }
    }

    @ViewBuilder
    private var requestDetail: some View {
        if let result = model.editor.lastResult {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    NetworkRequestDetailView(record: result.record)
                    if !result.assertionResults.isEmpty {
                        AssertionResultsView(results: result.assertionResults)
                    }
                }
                .padding(16)
            }
        } else if let error = model.editor.lastRunError {
            EmptyStateView(systemImage: "exclamationmark.triangle", title: "Send failed", message: error)
        } else {
            EmptyStateView(
                systemImage: "arrow.up.right.circle",
                title: "No response yet",
                message: "Send the request to see its response here.",
            )
        }
    }

    @ViewBuilder
    private var trafficDetail: some View {
        if let id = model.traffic.selectedRequestID, let request = model.traffic.request(id: id) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Button("Save to Collection") { model.saveCaptured(request) }
                    NetworkRequestDetailView(record: request)
                }
                .padding(16)
            }
        } else {
            EmptyStateView(
                systemImage: "list.bullet",
                title: "Select a request",
                message: "Pick a captured request from the traffic list.",
            )
        }
    }
}
