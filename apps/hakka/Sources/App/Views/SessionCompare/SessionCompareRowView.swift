import HakkaCommon
import HakkaCore
import SwiftUI

/// One finding: a request added, removed, or present in both runs (possibly
/// reordered, possibly changed). Reuses `RequestDiffView` for the full
/// status/headers/body detail on a changed pair instead of re-rendering
/// `RequestDiff`'s fields a second way.
struct SessionCompareRowView: View {
    let entry: SessionDiff.Entry

    @State private var showingDetail = false

    var body: some View {
        Button {
            if isMatchedWithDiffableChange { showingDetail = true }
        } label: {
            HStack(alignment: .top, spacing: Spacing.md) {
                Image(systemName: symbol).foregroundStyle(color).frame(width: 16)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    HStack(spacing: Spacing.sm) {
                        Text(key.method.rawValue)
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Fmt.methodColor(key.method))
                        Text(key.normalizedPath).font(.callout)
                        if key.ordinal > 1 {
                            Text("call #\(key.ordinal)").font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                    ForEach(details, id: \.self) { line in
                        Text(line).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }
        }
        .buttonStyle(.plain)
        .padding(Spacing.ml)
        .background(RoundedRectangle(cornerRadius: 8).fill(.quaternary.opacity(0.3)))
        .sheet(isPresented: $showingDetail) {
            if case let .matched(pair) = entry {
                RequestDiffView(before: pair.before, after: pair.after) { showingDetail = false }
            }
        }
    }

    private var key: SessionRequestKey {
        switch entry {
        case let .matched(pair): pair.key
        case let .added(key, _): key
        case let .removed(key, _): key
        }
    }

    private var isMatchedWithDiffableChange: Bool {
        if case let .matched(pair) = entry { pair.hasNotableChange } else { false }
    }

    private var symbol: String {
        switch entry {
        case .added: "plus.circle.fill"
        case .removed: "minus.circle.fill"
        case let .matched(pair) where pair.reordered: "arrow.up.arrow.down.circle.fill"
        case .matched: "checkmark.circle.fill"
        }
    }

    private var color: Color {
        switch entry {
        case .added: ThemeTokens.Status.success
        case .removed: ThemeTokens.Status.error
        case let .matched(pair) where pair.hasNotableChange: ThemeTokens.Status.warning
        case .matched: .secondary
        }
    }

    /// Noise-controlled summary lines — only the flags `SessionDiff` decided
    /// were worth surfacing, never the full line-level body diff.
    private var details: [String] {
        switch entry {
        case .added:
            return ["Added in this run"]
        case .removed:
            return ["Removed in this run"]
        case let .matched(pair):
            var lines: [String] = []
            if pair.reordered {
                lines.append("Moved: call #\(pair.beforeIndex + 1) → call #\(pair.afterIndex + 1)")
            }
            if pair.diff.status.changed {
                lines.append("Status: \(pair.diff.status.before.map(String.init) ?? "–") → \(pair.diff.status.after.map(String.init) ?? "–")")
            }
            if pair.durationChangedBeyondThreshold {
                lines.append("Duration: \(Fmt.duration(pair.before.duration)) → \(Fmt.duration(pair.after.duration))")
            }
            if pair.requestBodyShapeChanged { lines.append("Request body shape changed") }
            if pair.responseBodyShapeChanged { lines.append("Response body shape changed") }
            let headerNames = pair.diff.requestHeaders.added.map(\.name) + pair.diff.responseHeaders.added.map(\.name)
            if !headerNames.isEmpty { lines.append("Headers added: \(headerNames.joined(separator: ", "))") }
            let removedNames = pair.diff.requestHeaders.removed.map(\.name) + pair.diff.responseHeaders.removed.map(\.name)
            if !removedNames.isEmpty { lines.append("Headers removed: \(removedNames.joined(separator: ", "))") }
            return lines
        }
    }
}
