import HakkaCore
import SwiftUI

/// The folder-run detail pane: a header with the pass/fail totals and total
/// duration, then one row per request in run order — name, status, duration,
/// and which assertions passed or failed, mirroring `AssertionResultsView`'s
/// per-assertion rows for a single request's response.
struct FolderRunSummaryView: View {
    let summary: FolderRunSummary

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            header
            VStack(alignment: .leading, spacing: Spacing.ml) {
                ForEach(summary.items) { item in
                    FolderRunItemRow(item: item)
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(summary.folderName).font(.title3.weight(.semibold))
            HStack(spacing: Spacing.ml) {
                Label("\(summary.passedCount) passed", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(ThemeTokens.Status.success)
                if summary.failedCount > 0 {
                    Label("\(summary.failedCount) failed", systemImage: "xmark.circle.fill")
                        .foregroundStyle(ThemeTokens.Status.error)
                }
                Text(Fmt.duration(summary.totalDurationMs))
                    .foregroundStyle(.secondary)
            }
            .font(.caption)
        }
    }
}

private struct FolderRunItemRow: View {
    let item: FolderRunItem

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.md) {
                Image(systemName: statusSymbol)
                    .foregroundStyle(statusColor)
                Text(item.method.rawValue)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Fmt.methodColor(item.method))
                    .frame(width: 40, alignment: .leading)
                Text(item.name)
                    .font(.callout)
                Spacer()
                Text(Fmt.duration(item.durationMs))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let message = failureMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(ThemeTokens.Status.error)
                    .padding(.leading, 48)  // ui-token-check-ignore: aligns under the method column above (width 40 + gap 8)
            }
            if !item.assertionResults.isEmpty {
                AssertionResultsView(results: item.assertionResults)
                    .padding(.leading, 48)  // ui-token-check-ignore: aligns under the method column above (width 40 + gap 8)
            }
        }
    }

    private var statusSymbol: String {
        switch item.status {
        case .passed: "checkmark.circle.fill"
        case .assertionsFailed: "xmark.circle.fill"
        case .requestFailed: "wifi.exclamationmark"
        case .resolutionFailed: "exclamationmark.triangle.fill"
        }
    }

    private var statusColor: Color {
        switch item.status {
        case .passed: ThemeTokens.Status.success
        case .assertionsFailed, .requestFailed: ThemeTokens.Status.error
        case .resolutionFailed: ThemeTokens.Status.warning
        }
    }

    private var failureMessage: String? {
        switch item.status {
        case .passed, .assertionsFailed: nil
        case let .requestFailed(message): message
        case let .resolutionFailed(message): message
        }
    }
}
