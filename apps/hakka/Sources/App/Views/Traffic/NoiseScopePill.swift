import SwiftUI

/// The Focus/Noise scope's toolbar affordance — distinct from the search
/// field and `FilterPresetMenu` on purpose: a preset is a query you re-type,
/// this is a lens you leave on, so it needs its own control rather than
/// living inside the search pill's chrome. Only renders when a scope is
/// active, so an idle app pays no toolbar cost.
///
/// Placement decision: this sits in `LiveTrafficHeader`'s local toolbar, not
/// the app's window toolbar. The design canvas drew a "noise control pill"
/// on the *main* window toolbar and flagged it exploratory, noting the
/// tension with HIG's guidance against overloading a toolbar. That drawn
/// placement is rejected here for a second, more specific reason beyond the
/// general HIG concern: the window toolbar is shared across all five tabs
/// (`swiftui-patterns.md`), and a Traffic-only scope pinned there would
/// either show up meaninglessly on Stats/Logs/Rules/Storage or need
/// per-tab visibility logic HIG doesn't ask any toolbar to carry. The
/// traffic header is already a filtering toolbar — it owns search and
/// presets — so a standing filter lens belongs there, conditionally
/// rendered, instead of adding a sixth permanent control to the window
/// chrome.
struct NoiseScopePill: View {
    let scope: NoiseScopeStore
    let hiddenCount: Int
    let hiddenErrorCount: Int

    var body: some View {
        if scope.isActive {
            HStack(spacing: Spacing.xs) {
                Image(systemName: "eye.slash")
                Text(summary)
                if hiddenErrorCount > 0 {
                    Text("\(hiddenErrorCount)")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, Spacing.xs)
                        .background(ThemeTokens.Status.error, in: Capsule())
                        .foregroundStyle(ThemeTokens.Status.on)
                        .accessibilityLabel("\(hiddenErrorCount) hidden erroring")
                }
                Button {
                    scope.clear()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear noise scope")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, Spacing.xs)
            .background(.quaternary.opacity(0.5), in: Capsule())
        }
    }

    private var summary: String {
        let ruleCount = scope.excludeRules.count + scope.includeRules.count
        let noun = ruleCount == 1 ? "rule" : "rules"
        return "\(ruleCount) \(noun) · \(hiddenCount) hidden"
    }
}
