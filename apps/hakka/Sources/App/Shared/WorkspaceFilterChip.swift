import SwiftUI

/// Filter selection stays legible on opaque surfaces and has a checkmark cue.
struct WorkspaceFilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.xs) {
                if isSelected {
                    Image(systemName: "checkmark")
                        .accessibilityHidden(true)
                }
                Text(title)
            }
            .font(.caption.weight(.medium))
            .fixedSize()
            .foregroundStyle(isSelected ? ThemeTokens.Palette.text : ThemeTokens.Palette.textSecondary)
            .padding(.horizontal, Spacing.md)
            .frame(minHeight: ControlHeight.md)
            .background(isSelected ? ThemeTokens.Palette.surfaceRaised : ThemeTokens.Palette.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(isSelected ? ThemeTokens.Palette.textSecondary : ThemeTokens.Palette.border))
        }
        .buttonStyle(.borderless)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
