import HakkaCommon
import SwiftUI

/// Method scope on an opaque surface keeps its semantic text color legible.
struct MethodChipView: View {
    let method: String?

    private var label: String { method?.uppercased() ?? "ANY" }
    private var color: Color { Fmt.methodColor(for: method) }

    var body: some View {
        Text(label)
            .font(.caption.monospaced().weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, Spacing.xs)
            .background(ThemeTokens.Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(ThemeTokens.Palette.border)
            )
            .accessibilityLabel(method.map { "\($0) method" } ?? "Any method")
    }
}

/// Live hit count uses a readable neutral badge.
struct HitCountBadgeView: View {
    let count: Int

    var body: some View {
        Text("\(count)")
            .font(.caption.monospacedDigit().weight(.medium))
            .foregroundStyle(ThemeTokens.Palette.textSecondary)
            .padding(.horizontal, Spacing.xs)
            .padding(.vertical, Spacing.xxs)
            .background(ThemeTokens.Palette.surfaceRaised, in: Capsule())
            .accessibilityLabel(count == 1 ? "1 hit" : "\(count) hits")
    }
}
