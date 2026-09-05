import HakkaCore
import SwiftUI

struct GitFileRowView: View {
    let entry: GitStatusEntry
    let isStaged: Bool
    let isSelected: Bool
    let git: GitModel

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Text(GitEntryLabel.code(for: entry))
                .font(.caption2.monospaced().weight(.bold))
                .foregroundStyle(GitEntryLabel.color(for: entry))
                .frame(width: 20, alignment: .leading)
            Text(entry.path)
                .font(.caption.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                Task {
                    if isStaged {
                        await git.unstage([entry.path])
                    } else {
                        await git.stage([entry.path])
                    }
                }
            } label: {
                Image(systemName: isStaged ? "minus.circle" : "plus.circle")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help(isStaged ? "Unstage" : "Stage")
            .accessibilityLabel(isStaged ? "Unstage \(entry.path)" : "Stage \(entry.path)")
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(isSelected ? Color.accentColor.opacity(0.14) : Color.clear, in: RoundedRectangle(cornerRadius: Radius.sm))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
