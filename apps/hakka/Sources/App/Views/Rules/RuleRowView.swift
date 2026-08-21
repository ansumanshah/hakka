import HakkaCore
import SwiftUI

/// One rule line: what it matches, what it does, the enable toggle, the
/// local hit count, and removal.
struct RuleRowView: View {
    let entry: RuleEntry
    let rules: RulesModel

    var body: some View {
        let display = RuleEntryDisplay(entry)
        HStack(spacing: 8) {
            Toggle("", isOn: toggleBinding)
                .labelsHidden()
                .help(entry.isEnabled ? "Disable" : "Enable")
            VStack(alignment: .leading, spacing: 2) {
                Text(display.title)
                    .font(.callout.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(entry.hitCount == 1 ? "1 hit" : "\(entry.hitCount) hits")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(display.subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
            Button {
                rules.remove(entry)
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Remove from devices")
        }
        .padding(.vertical, 2)
    }

    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { entry.isEnabled },
            set: { rules.setEnabled($0, entry: entry) }
        )
    }
}
