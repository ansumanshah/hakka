import HakkaCommon
import SwiftUI

/// The Logs surface: structured `LogEntry` records streamed from connected
/// devices over the `console` bridge frame kind. Single-pane like `RulesView`
/// (no `DetailPaneView` counterpart) — a log line has nothing further to
/// drill into today. Observation is owned by the app root
/// (`HakkaApp.swift`'s `.task`), not here — `BridgeHub.consoleEntries` is a
/// single-consumer stream.
struct LogsPanelView: View {
    @Environment(AppModel.self) private var model
    /// Whether the bottom sentinel row is on screen — the "at the newest
    /// entry" signal a new batch checks before auto-scrolling. Starts true
    /// so the very first render (nothing to scroll yet) doesn't read as
    /// already-paused.
    @State private var isAtBottom = true
    private static let bottomAnchorID = "logs-bottom-anchor"

    var body: some View {
        VStack(spacing: 0) {
            header
            LogsFilterBar(logs: model.logs)
            if model.logs.entries.isEmpty {
                EmptyStateView(
                    systemImage: "text.alignleft",
                    title: "No log entries yet",
                    message: "Structured logs from HakkaInterceptor.log(...) on a connected device show up here live."
                )
            } else if model.logs.filteredEntries.isEmpty {
                EmptyStateView(
                    systemImage: "line.3.horizontal.decrease.circle",
                    title: "No matching entries",
                    message: "\(model.logs.entries.count) captured, none match this search or level."
                )
            } else {
                logList
            }
        }
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            Text("Logs")
                .font(.headline)
            Text(countText)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            Spacer()
            Button("Clear", role: .destructive) {
                model.logs.clear()
            }
            .disabled(model.logs.entries.isEmpty)
        }
        .padding(Spacing.lg)
    }

    /// Matches `LiveTrafficHeader.countText`'s "N of total" shape so the
    /// same reading applies across both panels' toolbars.
    private var countText: String {
        let total = model.logs.entries.count
        let visible = model.logs.filteredEntries.count
        return visible == total ? "\(total) logs" : "\(visible) of \(total)"
    }

    /// Chronological, oldest to newest — unlike `LiveTrafficListView` (a
    /// selectable, newest-first table), a live log is read like a console:
    /// new lines arrive at the bottom and the view rides along, matching the
    /// iOS inspector's `LogsView.entryList` (`ScrollViewReader` + scroll-to-
    /// `.last` on count change). `isAtBottom` — flipped by the invisible
    /// sentinel row's `onAppear`/`onDisappear` — is this view's "pause when
    /// the user scrolls up to read history" switch: a batch that arrives
    /// while it's false is left alone, and "Jump to Latest" is offered
    /// instead of yanking the scroll position out from under a read in
    /// progress.
    private var logList: some View {
        ScrollViewReader { proxy in
            ZStack(alignment: .bottom) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Spacing.xs) {
                        ForEach(model.logs.filteredEntries) { entry in
                            LogRowView(entry: entry).id(entry.id)
                        }
                        Color.clear
                            .frame(height: 1)
                            .id(Self.bottomAnchorID)
                            .onAppear { isAtBottom = true }
                            .onDisappear { isAtBottom = false }
                    }
                    .padding(.horizontal, Spacing.lg)
                    .padding(.bottom, Spacing.lg)
                }
                .onChange(of: model.logs.filteredEntries.count) { _, _ in
                    guard isAtBottom else { return }
                    withAnimation(.spring(response: 0.25, dampingFraction: 0.9)) {
                        proxy.scrollTo(Self.bottomAnchorID, anchor: .bottom)
                    }
                }
                if !isAtBottom {
                    jumpToLatestButton(proxy: proxy)
                }
            }
        }
    }

    private func jumpToLatestButton(proxy: ScrollViewProxy) -> some View {
        Button {
            withAnimation(.spring(response: 0.25, dampingFraction: 0.9)) {
                proxy.scrollTo(Self.bottomAnchorID, anchor: .bottom)
            }
            isAtBottom = true
        } label: {
            Label("Jump to Latest", systemImage: "arrow.down.circle.fill")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm)
                .background(.regularMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
        .padding(.bottom, Spacing.md)
    }
}
