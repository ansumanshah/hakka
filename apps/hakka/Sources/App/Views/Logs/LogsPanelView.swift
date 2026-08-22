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

    var body: some View {
        VStack(spacing: 0) {
            header
            if model.logs.entries.isEmpty {
                EmptyStateView(
                    systemImage: "text.alignleft",
                    title: "No log entries yet",
                    message: "Structured logs from HakkaInterceptor.log(...) on a connected device show up here live."
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
            Text("\(model.logs.entries.count)")
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

    private var logList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.xs) {
                // Newest first — a live stream reads top-down like a chat
                // log, matching the mobile inspectors' Logs tab.
                ForEach(model.logs.entries.reversed()) { entry in
                    LogRowView(entry: entry)
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.lg)
        }
    }
}

/// One structured log line: level badge, message, optional category, and
/// time-of-day — mirrors `RequestRowView`'s two-column rhythm (identity
/// left, metadata right) from the mobile inspectors, compressed to one line
/// since a log entry carries far less than a network request.
private struct LogRowView: View {
    let entry: LogEntry

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Text(entry.level.rawValue.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(Fmt.logLevelColor(entry.level))
                .frame(width: 44, alignment: .leading)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(entry.message)
                    .font(.callout)
                    .textSelection(.enabled)
                if let category = entry.category {
                    Text(category)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: Spacing.md)
            Text(Fmt.time(entry.timestamp))
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, Spacing.xxs)
    }
}
