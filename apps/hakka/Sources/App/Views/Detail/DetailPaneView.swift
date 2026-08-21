import HakkaCore
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
        case .rules:
            EmptyStateView(systemImage: "slider.horizontal.3", title: "Rules", message: "Select a rule section to manage device rules.")
        case .folderRun:
            folderRunDetail
        case nil:
            EmptyStateView(systemImage: "doc.text.magnifyingglass", title: "Nothing selected")
        }
    }

    @ViewBuilder
    private var folderRunDetail: some View {
        if model.folderRun.isRunning {
            EmptyStateView(systemImage: "play.circle", title: "Running…", message: "Requests are running in order.")
        } else if let summary = model.folderRun.summary {
            ScrollView {
                FolderRunSummaryView(summary: summary)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else if model.folderRun.lastRunWasEmpty {
            EmptyStateView(systemImage: "tray", title: "No requests", message: "This folder has no requests to run.")
        } else {
            EmptyStateView(systemImage: "checklist", title: "No run yet")
        }
    }

    @ViewBuilder
    private var requestDetail: some View {
        // A `ws://`/`wss://` draft gets the frame console instead of the
        // normal send/response view, checked before `lastResult` — a socket
        // is a connect-then-many-frames session, not a send-then-one-response
        // run, so it never waits for (or produces) a `RunResult`.
        if let draft = model.editor.draft, WebSocketURL.isWebSocketURL(draft.url) {
            ScrollView {
                DetailFramesTabView(model: model.webSocket, url: draft.url)
                    .padding(16)
            }
        } else if let result = model.editor.lastResult {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    NetworkRequestDetailView(record: result.record)
                        .id(result.record.id)
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
                        HStack {
                            DetailActionBar(
                                request: request,
                                onReplay: { model.replayCaptured(request) },
                                onSave: { model.saveCaptured(request) },
                                onMock: { model.promoteCapturedToMock(request) },
                                mockNote: model.mockPromotionNote
                            )
                            // Cross-target trace waterfall (ADR 0001) — only
                            // renders itself when this request's trace has
                            // more than one participant target.
                            TraceAffordanceButton(traffic: model.traffic, requestID: request.id)
                        }
                        NetworkRequestDetailView(record: request)
                            .id(request.id)
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
