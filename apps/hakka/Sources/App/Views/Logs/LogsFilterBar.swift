import HakkaCommon
import SwiftUI

/// Search field + level chips over `LogsModel`'s `searchText`/`levelFilter` —
/// the interaction grammar of the iOS inspector's Logs tab
/// (`ios/Sources/UI/Logs/LogsView.swift`'s `filterBar`/`levelChip`), rebuilt
/// with the desktop's own capsule-button idiom (`LiveTrafficHeader.modeButton`)
/// rather than iOS's `HakkaChip` (UIKit-gated, not visible to this module —
/// see `swiftui-patterns.md`). Split out of `LogsPanelView.swift` to hold the
/// 200-line budget.
struct LogsFilterBar: View {
    @Bindable var logs: LogsModel

    var body: some View {
        HStack(spacing: Spacing.sm) {
            searchField
            levelChip(nil, label: "All")
            ForEach(LogLevel.allCases, id: \.rawValue) { level in
                levelChip(level, label: level.label)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.md)
    }

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Search message or metadata", text: $logs.searchText)
                .textFieldStyle(.plain)
                .font(.caption)
            if !logs.searchText.isEmpty {
                Button {
                    logs.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: Radius.md))
        .frame(minWidth: 160)
    }

    private func levelChip(_ level: LogLevel?, label: String) -> some View {
        let isActive = logs.levelFilter == level
        return Button {
            logs.levelFilter = level
        } label: {
            Text(label)
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, Spacing.sm)
                .padding(.vertical, Spacing.xs)
                .background(isActive ? chipColor(level).opacity(0.2) : Color.secondary.opacity(0.08), in: Capsule())
                .foregroundStyle(isActive ? chipColor(level) : .secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label) level filter")
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    private func chipColor(_ level: LogLevel?) -> Color {
        guard let level else { return .accentColor }
        return Fmt.logLevelColor(level)
    }
}
