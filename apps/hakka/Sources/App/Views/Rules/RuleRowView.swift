import HakkaCore
import SwiftUI

/// One rule line, per the design's row anatomy: a method chip, the pattern
/// in mono, what the rule does, a hit-count badge, and the enable toggle —
/// in that order. The trash affordance the design never drew is kept
/// trailing anyway (a reasonable addition over the design, not a gap): a
/// rule created by mistake needs a way out that isn't "disable it forever".
struct RuleRowView: View {
    let entry: RuleEntry
    let rules: RulesModel

    var body: some View {
        let display = RuleEntryDisplay(entry)
        HStack(spacing: Spacing.md) {
            MethodChipView(method: display.method)
            Text(display.pattern)
                .font(.callout.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
            Text(display.subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .layoutPriority(1)
            Spacer(minLength: Spacing.sm)
            HitCountBadgeView(count: entry.hitCount)
            Toggle("", isOn: toggleBinding)
                .labelsHidden()
                .help(entry.isEnabled ? "Disable" : "Enable")
            Button {
                rules.remove(entry)
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Remove from devices")
            .accessibilityLabel("Remove rule")
        }
        .padding(.vertical, Spacing.xxs)
    }

    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { entry.isEnabled },
            set: { rules.setEnabled($0, entry: entry) }
        )
    }
}
