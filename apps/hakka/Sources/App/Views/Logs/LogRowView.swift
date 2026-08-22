import AppKit
import HakkaCommon
import SwiftUI

/// One structured log line: level badge, message, optional category, and
/// time-of-day — mirrors `RequestRowView`'s two-column rhythm (identity
/// left, metadata right) from the mobile inspectors, compressed to one line
/// since a log entry carries far less than a network request. Split out of
/// `LogsPanelView.swift` to hold the 200-line budget.
struct LogRowView: View {
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
        .contentShape(Rectangle())
        .contextMenu {
            Button("Copy Message") { copy(entry.message) }
            if let metadataText = metadataText {
                Button("Copy with Metadata") { copy("\(entry.message)\n\(metadataText)") }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(entry.level.label): \(entry.message)")
    }

    private var metadataText: String? {
        guard let metadata = entry.metadata, !metadata.isEmpty else { return nil }
        return metadata.keys.sorted()
            .map { "\($0): \(metadata[$0] ?? "")" }
            .joined(separator: "\n")
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
