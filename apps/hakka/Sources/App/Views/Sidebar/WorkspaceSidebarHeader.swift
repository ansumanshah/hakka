import SwiftUI

/// Compact project identity for the source list. Collection opening lives in
/// the adjacent menu so it stays available without a permanent bottom bar.
struct WorkspaceSidebarHeader: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(model.collection.collection.name)
                    .font(.headline)
                    .lineLimit(1)
                Text(model.collection.directoryURL?.lastPathComponent ?? "Local workspace")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .layoutPriority(1)

            Spacer(minLength: Spacing.xs)

            Menu {
                Button(model.collection.directoryURL == nil ? "Open Collection…" : "Open Another Collection…") {
                    Task { await model.openCollectionDirectory() }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: ControlHeight.icon, height: ControlHeight.icon)
                    .background(.quaternary, in: Circle())
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Project options")
            .accessibilityLabel("Project options")
        }
        .padding(.vertical, Spacing.sm)
        .contextMenu {
            Button(model.collection.directoryURL == nil ? "Open Collection…" : "Open Another Collection…") {
                Task { await model.openCollectionDirectory() }
            }
        }
        .accessibilityElement(children: .contain)
    }
}
