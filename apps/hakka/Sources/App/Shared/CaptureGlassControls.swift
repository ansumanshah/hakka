import SwiftUI

/// Keeps capture and inspector controls in a shared native glass group.
struct CaptureGlassControls<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        if #available(macOS 26.0, *) {
            GlassEffectContainer(spacing: Spacing.md) {
                content()
            }
        } else {
            content()
        }
    }
}

private struct CaptureGlassButtonStyleModifier: ViewModifier {
    var prominent: Bool

    func body(content: Content) -> some View {
        if #available(macOS 26.0, *) {
            if prominent {
                content.buttonStyle(.glassProminent).buttonBorderShape(.roundedRectangle(radius: Radius.lg)).tint(ThemeTokens.Palette.accent)
            } else {
                content.buttonStyle(.glass).buttonBorderShape(.roundedRectangle(radius: Radius.lg))
            }
        } else if prominent {
            content.buttonStyle(.borderedProminent).tint(ThemeTokens.Palette.accent)
        } else {
            content.buttonStyle(.bordered)
        }
    }
}

private struct CaptureMenuLabelModifier: ViewModifier {
    var iconOnly: Bool

    func body(content: Content) -> some View {
        let label = content
            .font(.system(size: FontSize.md, weight: .medium))
            .padding(.horizontal, iconOnly ? Spacing.md : Spacing.lg)
            .frame(height: ControlHeight.icon + Spacing.xxs)
        if #available(macOS 26.0, *) {
            label.glassEffect(.regular.interactive(), in: .rect(cornerRadius: Radius.lg))
        } else {
            label.background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.lg))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.lg)
                        .strokeBorder(ThemeTokens.Palette.border)
                        .allowsHitTesting(false)
                }
        }
    }
}

extension View {
    func captureMenuLabelStyle(iconOnly: Bool = false) -> some View {
        modifier(CaptureMenuLabelModifier(iconOnly: iconOnly))
    }

    func captureGlassButtonStyle(prominent: Bool = false) -> some View {
        modifier(CaptureGlassButtonStyleModifier(prominent: prominent))
    }
}
