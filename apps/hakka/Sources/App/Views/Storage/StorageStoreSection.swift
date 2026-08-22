import HakkaCommon
import SwiftUI

/// One store's snapshot: name, entry count, last-updated time, and its
/// key/value entries in a disclosure group — collapsed by default so a
/// device with several stores (defaults, keychain, cookies) doesn't dump
/// every value on screen at once. Split out of `StoragePanelView.swift` to
/// hold the 200-line budget.
struct StorageStoreSection: View {
    let snapshot: StorageSnapshot
    @State private var isExpanded = true

    /// A snapshot older than this reads as stale — snapshot-replace
    /// semantics mean there is no live diff, only "how long ago did this
    /// store last report in", so a device that stopped calling
    /// `publishStorageSnapshot` looks frozen rather than silently wrong.
    private static let staleThreshold: TimeInterval = 30

    private var sortedEntries: [(key: String, value: String)] {
        snapshot.entries.sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
    }

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            if sortedEntries.isEmpty {
                Text("No entries")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.top, Spacing.xs)
            } else {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    ForEach(sortedEntries, id: \.key) { entry in
                        StorageEntryRow(key: entry.key, value: entry.value)
                    }
                }
                .padding(.top, Spacing.xs)
            }
        } label: {
            HStack(spacing: Spacing.md) {
                Text(snapshot.store)
                    .font(.subheadline.weight(.semibold))
                Text("\(snapshot.entries.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
                snapshotAgeBadge
            }
        }
        .padding(Spacing.lg)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
    }

    /// Relative "12s ago" reading — `Text(_:style:.relative)` auto-updates
    /// on its own each second (the house pattern already used by
    /// `PauseRowView.body`'s `Text(pause.arrivedAt, style: .relative)`), but
    /// its text alone doesn't say a snapshot has actually gone stale.
    /// `TimelineView` re-evaluates `isStale` on the same cadence so the
    /// warning tint keeps pace with the label instead of only coloring in
    /// at the moment this row happened to redraw for some other reason.
    private var snapshotAgeBadge: some View {
        let date = Date(timeIntervalSince1970: Double(snapshot.timestamp) / 1000)
        return TimelineView(.periodic(from: date, by: 1)) { context in
            let isStale = context.date.timeIntervalSince(date) > Self.staleThreshold
            HStack(spacing: Spacing.xxs) {
                if isStale {
                    Image(systemName: "clock.badge.exclamationmark")
                        .accessibilityHidden(true)
                }
                Text(date, style: .relative)
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(isStale ? ThemeTokens.Status.warning : .secondary)
            .accessibilityLabel(isStale ? "Snapshot stale, last updated \(date.formatted(date: .omitted, time: .standard))" : "Last updated \(date.formatted(date: .omitted, time: .standard))")
        }
    }
}
