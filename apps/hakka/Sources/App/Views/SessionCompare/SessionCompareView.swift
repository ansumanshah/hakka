import HakkaCore
import SwiftUI

/// "This deploy added 3 requests, made /orders 200ms slower, and started
/// sending a header that wasn't there yesterday" — rendered. Two saved
/// `.hakka-session` runs of the same flow, diffed by `SessionDiff`, shown as
/// run totals plus one row per finding.
///
/// Noise control carries into the view, not just the model: unchanged pairs
/// are collapsed behind a toggle by default, because a diff that always
/// shows every unchanged request is as unreadable as one that flags every
/// timing jitter.
struct SessionCompareView: View {
    let diff: SessionDiff
    let beforeName: String
    let afterName: String
    let dismiss: () -> Void

    @State private var showUnchanged = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(visibleEntries) { entry in
                        SessionCompareRowView(entry: entry)
                    }
                }
                .padding(16)
            }
        }
        .frame(minWidth: 620, minHeight: 460)
    }

    private var visibleEntries: [SessionDiff.Entry] {
        showUnchanged ? diff.entries : diff.entries.filter(isNotable)
    }

    private func isNotable(_ entry: SessionDiff.Entry) -> Bool {
        switch entry {
        case .added, .removed: true
        case let .matched(pair): pair.hasNotableChange
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Compare Sessions").font(.title3.weight(.semibold))
                Spacer()
                Button("Done", action: dismiss).keyboardShortcut(.cancelAction)
            }
            HStack(spacing: 16) {
                runTotals(name: beforeName, stats: diff.before)
                Image(systemName: "arrow.right").foregroundStyle(.tertiary)
                runTotals(name: afterName, stats: diff.after)
                Spacer()
                Toggle("Show unchanged", isOn: $showUnchanged)
                    .toggleStyle(.checkbox)
                    .font(.caption)
            }
            if notableCount == 0 {
                Label("No notable differences between these runs.", systemImage: "checkmark.circle")
                    .font(.callout)
                    .foregroundStyle(ThemeTokens.Status.success)
            }
        }
        .padding(16)
    }

    private var notableCount: Int {
        diff.entries.count { isNotable($0) }
    }

    private func runTotals(name: String, stats: TrafficStats) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name).font(.caption.weight(.semibold)).lineLimit(1)
            Text("\(stats.count) requests · \(stats.errorCount) errors · \(Fmt.bytes(stats.totalBytes))")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
