import SwiftUI

/// Consistent, readable placeholder for an empty workspace or inspector.
struct EmptyStateView: View {
    let systemImage: String
    let title: String
    var message: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                content
                    .frame(minHeight: geometry.size.height)
            }
        }
    }

    private var content: some View {
        VStack(spacing: Spacing.xl) {
            Image(systemName: systemImage)
                .font(.system(size: 32, weight: .regular)) // ui-token-check-ignore: empty-state illustration
                .symbolRenderingMode(.monochrome)
                .foregroundStyle(ThemeTokens.Palette.textSecondary)
                .padding(Spacing.lg)
                .background(ThemeTokens.Palette.surface, in: RoundedRectangle(cornerRadius: Radius.lg))
                .accessibilityHidden(true)
            Text(title)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .foregroundStyle(ThemeTokens.Palette.text)
            if let message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(ThemeTokens.Palette.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 360) // ui-token-check-ignore: empty-state reading measure
            }
            if let actionTitle, let action {
                Button(action: action) {
                    CaptureActionLabel(actionTitle, isProminent: true)
                }
                .captureGlassButtonStyle(prominent: true)
                .controlSize(.regular)
                .padding(.top, Spacing.xs)
            }
        }
        .padding(Spacing.xxxl)
        .frame(minWidth: 0, maxWidth: .infinity)
    }
}
