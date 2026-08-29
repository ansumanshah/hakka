import HakkaCommon
import HakkaCore
import SwiftUI

/// Right column: the active request's last response, or the selected
/// captured-traffic row's record — both render through the same
/// `NetworkRequestDetailView` since both are a `NetworkRequest`.
struct DetailPaneView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The request the promote-to-mock sheet was opened for — set by
    /// `DetailActionBar`'s Mock button instead of that button installing
    /// directly (gap-audit-2026-08-22.md item 2).
    @State private var promoteRequest: NetworkRequest?

    var body: some View {
        selectionContent
            // Switching what the sidebar has selected — a different request,
            // Traffic, Rules, Logs, Storage, a folder run — swaps this whole
            // pane's content wholesale. A crossfade on that swap, keyed
            // directly on `model.selection`, is the "panel reveal" case
            // `swiftui-patterns.md` calls out; it only fires on that
            // deliberate switch, never on live data updates within one
            // selection (those are each branch's own concern below).
            .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.85), value: model.selection)
            .sheet(item: $promoteRequest) { request in
                PromoteMockSheet(request: request)
            }
    }

    @ViewBuilder
    private var selectionContent: some View {
        switch model.selection {
        case .request:
            requestDetail
                .transition(.opacity)
        case .traffic:
            trafficDetail
                .transition(.opacity)
        case .rules:
            EmptyStateView(systemImage: "slider.horizontal.3", title: "Rules", message: "Select a rule section to manage device rules.")
                .transition(.opacity)
        case .logs:
            EmptyStateView(systemImage: "text.alignleft", title: "Logs", message: "Structured log entries streamed from connected devices.")
                .transition(.opacity)
        case .storage:
            EmptyStateView(systemImage: "externaldrive", title: "Storage", message: "Select a store in the list to inspect its entries.")
                .transition(.opacity)
        case .folderRun:
            folderRunDetail
                .transition(.opacity)
        case nil:
            EmptyStateView(systemImage: "doc.text.magnifyingglass", title: "Nothing selected")
                .transition(.opacity)
        }
    }

    @ViewBuilder
    private var folderRunDetail: some View {
        if model.folderRun.isRunning {
            EmptyStateView(systemImage: "play.circle", title: "Running…", message: "Requests are running in order.")
        } else if let summary = model.folderRun.summary {
            ScrollView {
                FolderRunSummaryView(summary: summary)
                    .padding(Spacing.xl)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else if model.folderRun.lastRunWasEmpty {
            EmptyStateView(systemImage: "tray", title: "No requests", message: "This folder has no requests to run.")
        } else {
            EmptyStateView(systemImage: "checklist", title: "No run yet")
        }
    }

    /// What `requestDetail` is showing, coarse enough to drive its crossfade
    /// without re-triggering on every keystroke in the editor — only a
    /// genuine send outcome (or a different one replacing it) changes this.
    private enum RequestDetailState: Equatable {
        case webSocket
        case result(String)
        case error
        case empty
    }

    private var requestDetailState: RequestDetailState {
        if let draft = model.editor.draft, WebSocketURL.isWebSocketURL(draft.url) {
            .webSocket
        } else if let result = model.editor.lastResult {
            .result(result.record.id)
        } else if model.editor.lastRunError != nil {
            .error
        } else {
            .empty
        }
    }

    @ViewBuilder
    private var requestDetail: some View {
        // A `ws://`/`wss://` draft gets the frame console instead of the
        // normal send/response view, checked before `lastResult` — a socket
        // is a connect-then-many-frames session, not a send-then-one-response
        // run, so it never waits for (or produces) a `RunResult`.
        Group {
            if let draft = model.editor.draft, WebSocketURL.isWebSocketURL(draft.url) {
                ScrollView {
                    DetailFramesTabView(model: model.webSocket, url: draft.url)
                        .padding(Spacing.xl)
                }
            } else if let result = model.editor.lastResult {
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.xl) {
                        NetworkRequestDetailView(record: result.record)
                            .id(result.record.id)
                        if !result.assertionResults.isEmpty {
                            AssertionResultsView(results: result.assertionResults)
                        }
                    }
                    .padding(Spacing.xl)
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
        .transition(.opacity)
        // The literal "no response yet" → "response arrived" empty-to-
        // populated moment `swiftui-patterns.md` names — a Send is a single
        // bounded event, not traffic-list volume, so this is safe to tween.
        .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.85), value: requestDetailState)
    }

    /// What `trafficDetail` is showing — a diff, a selected request, or
    /// nothing — coarse enough to drive its crossfade without re-triggering
    /// while `visibleRequests` itself churns on the traffic hot path.
    private enum TrafficDetailState: Equatable {
        case comparison
        case request(String)
        case empty
    }

    private var trafficDetailState: TrafficDetailState {
        if model.traffic.comparison != nil {
            .comparison
        } else if let id = model.traffic.selectedRequestID, model.traffic.request(id: id) != nil {
            .request(id)
        } else {
            .empty
        }
    }

    @ViewBuilder
    private var trafficDetail: some View {
        Group {
            if let pair = model.traffic.comparison {
                // A diff is a pane mode, not a modal (competitive-ux-2026-08
                // finding 5): staying in the three-pane layout keeps the row
                // list reachable, since the usual next step after a diff is
                // picking a third similar request to compare against —
                // selecting a different row simply changes which "after" this
                // pane shows, without leaving the comparison. "Done" is the
                // only way out now that there is no sheet to swipe away.
                RequestDiffView(before: pair.before, after: pair.after) {
                    model.traffic.comparisonBaselineID = nil
                }
            } else if let id = model.traffic.selectedRequestID, let request = model.traffic.request(id: id) {
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.xl) {
                        HStack {
                            DetailActionBar(
                                request: request,
                                onReplay: { model.replayCaptured(request) },
                                onSave: { model.saveCaptured(request) },
                                onMock: { promoteRequest = request },
                                mockNote: model.mockPromotionNote
                            )
                            // Cross-target trace waterfall (ADR 0001) — only
                            // renders itself when this request's trace has
                            // more than one participant target.
                            TraceAffordanceButton(traffic: model.traffic, requestID: request.id)
                        }
                        NetworkRequestDetailView(record: request, deviceLabel: model.traffic.deviceLabel(for: request.id))
                            .id(request.id)
                    }
                    .padding(Spacing.xl)
                }
            } else {
                EmptyStateView(
                    systemImage: "list.bullet",
                    title: "Select a request",
                    message: "Pick a captured request from the traffic list.",
                )
            }
        }
        .transition(.opacity)
        // "Select a request" → a row's detail is the same empty-to-populated
        // moment as `requestDetail` above; keyed on `trafficDetailState`
        // rather than `selectedRequestID` alone so entering/leaving the diff
        // pane also crossfades.
        .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.85), value: trafficDetailState)
    }
}
