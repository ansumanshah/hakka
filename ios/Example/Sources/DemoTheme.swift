import SwiftUI

// The demo's chrome palette lives in `DemoPalette.generated.swift`, generated
// from `design-tokens.json` by `scripts/sync-design-tokens.mjs`. Run
// `just sync-tokens` after editing that file; `just sync-tokens-check` gates it
// in CI, so the demo cannot drift from the SDK's own palette.

// MARK: - Background + glass chrome

extension DemoView {
    var demoBackground: some View {
        ZStack {
            LinearGradient(
                colors: [
                    DemoPalette.background,
                    DemoPalette.surface,
                    DemoPalette.surfaceRaised,
                    DemoPalette.background,
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [DemoPalette.accent.opacity(0.16), .clear],
                center: .topLeading,
                startRadius: 24,
                endRadius: 360
            )
            RadialGradient(
                colors: [.cyan.opacity(0.12), .clear],
                center: .bottomTrailing,
                startRadius: 10,
                endRadius: 330
            )
        }
        .ignoresSafeArea()
    }

    @ViewBuilder
    func glassGroup<Content: View>(
        cornerRadius: CGFloat,
        @ViewBuilder content: () -> Content
    ) -> some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 22) {
                content()
                    .glassEffect(.regular.tint(.white.opacity(0.08)), in: .rect(cornerRadius: cornerRadius))
            }
        } else {
            content()
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .stroke(.white.opacity(0.10), lineWidth: 0.5)
                )
        }
    }
}

extension View {
    @ViewBuilder
    func demoGlass(tint: Color, cornerRadius: CGFloat, interactive: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(iOS 26.0, *) {
            if interactive {
                self.glassEffect(.regular.tint(tint).interactive(), in: shape)
            } else {
                self.glassEffect(.regular.tint(tint), in: shape)
            }
        } else {
            self
                .background(.ultraThinMaterial, in: shape)
                .overlay(shape.stroke(.white.opacity(0.10), lineWidth: 0.5))
        }
    }

    @ViewBuilder
    func demoGlassButton(tint: Color = .white, prominent: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            if prominent {
                self.buttonStyle(.glassProminent)
            } else {
                self.buttonStyle(.glass(.regular.tint(tint.opacity(0.18))))
            }
        } else {
            self
                .buttonStyle(.plain)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(tint.opacity(0.32), lineWidth: 0.5)
                )
        }
    }
}
