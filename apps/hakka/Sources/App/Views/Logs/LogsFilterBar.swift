import HakkaCommon
import SwiftUI

/// Search and level filters share the workspace's search and control geometry.
struct LogsFilterBar: View {
    @Environment(AppModel.self) private var model
    @Bindable var logs: LogsModel

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            searchField
            ScrollView(.horizontal, showsIndicators: true) {
                HStack(spacing: Spacing.sm) {
                    levelChip(nil, label: "All")
                    ForEach(LogLevel.allCases, id: \.rawValue) { level in
                        levelChip(level, label: level.label)
                    }
                }
            }
        }
        .padding(.horizontal, Layout.gutter)
        .padding(.bottom, Spacing.md)
    }

    private var searchField: some View {
        WorkspaceSearchField(
            prompt: "Search messages and metadata",
            accessibilityName: "Search logs",
            text: $logs.searchText,
            focusToken: model.workspaceSearchFocusToken,
            helpText: "Press Command-F to search this workspace."
        )
    }

    private func levelChip(_ level: LogLevel?, label: String) -> some View {
        WorkspaceFilterChip(title: label, isSelected: logs.levelFilter == level) {
            logs.levelFilter = level
        }
        .accessibilityLabel("\(label) level filter")
    }
}
