import SwiftUI

/// Active traffic scope and hidden errors remain visible beside traffic filters.
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
                    Label("\(hiddenErrorCount)", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, Spacing.xs)
                        .background(ThemeTokens.Palette.surfaceRaised, in: Capsule())
                        .foregroundStyle(ThemeTokens.Status.error)
                        .accessibilityLabel("\(hiddenErrorCount) hidden erroring")
                }
                Button {
                    scope.clear()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .frame(width: ControlHeight.chip, height: ControlHeight.chip)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Reset Focus and Noise")
            }
            .font(.caption)
            .foregroundStyle(ThemeTokens.Palette.textSecondary)
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, Spacing.xs)
            .background(ThemeTokens.Palette.surface, in: Capsule())
        }
    }

    private var summary: String {
        if let focus = scope.activeFocusSet {
            return "\(focus.name) · \(hiddenCount) hidden"
        }
        let ruleCount = scope.excludeRules.count + scope.includeRules.count
        let noun = ruleCount == 1 ? "rule" : "rules"
        return "\(ruleCount) \(noun) · \(hiddenCount) hidden"
    }
}
