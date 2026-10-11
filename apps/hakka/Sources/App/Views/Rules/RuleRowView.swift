import HakkaCore
import SwiftUI

/// Pattern and rule behavior stay together; controls remain in a stable trailing group.
struct RuleRowView: View {
    let entry: RuleEntry
    let rules: RulesModel

    var body: some View {
        let display = RuleEntryDisplay(entry)
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(spacing: Spacing.sm) {
                    MethodChipView(method: display.method)
                    Text(display.pattern)
                        .font(.callout.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(display.pattern)
                }
                Text(display.subtitle)
                    .font(.caption)
                    .foregroundStyle(ThemeTokens.Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HitCountBadgeView(count: entry.hitCount)
            Toggle("", isOn: toggleBinding)
                .labelsHidden()
                .accessibilityLabel("Enable rule for \(display.pattern)")
                .help(entry.isEnabled ? "Disable" : "Enable")
            Button {
                rules.remove(entry)
            } label: {
                Image(systemName: "trash")
                    .frame(width: ControlHeight.chip, height: ControlHeight.chip)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.secondary)
            .help("Remove from devices")
            .accessibilityLabel("Remove rule")
        }
        .padding(.vertical, Spacing.sm)
    }

    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { entry.isEnabled },
            set: { rules.setEnabled($0, entry: entry) }
        )
    }
}
