import SwiftUI

/// The "Your app → Hakka SDK → This window" flow from Artboard 6 — three
/// nodes and two connecting arrows, drawn with plain SwiftUI shapes (no
/// image assets) so it stays crisp at any window size and follows the
/// system's light/dark appearance rather than the artboard's fixed dark
/// palette.
struct FirstRunFlowDiagram: View {
    var body: some View {
        HStack(spacing: Spacing.md) {
            node(title: "Your app")
            arrow
            node(title: "Hakka SDK", caption: "already inside it")
            arrow
            node(title: "This window", caption: "live now", isAccent: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Your app, to the Hakka SDK already inside it, to this window, live now")
    }

    private var arrow: some View {
        Image(systemName: "arrow.right")
            .font(.system(size: FontSize.xl))
            .foregroundStyle(.tertiary)
    }

    private func node(title: String, caption: String? = nil, isAccent: Bool = false) -> some View {
        VStack(spacing: Spacing.xxs) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(isAccent ? ThemeTokens.Status.onWarm : Color.primary)
            if let caption {
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(isAccent ? ThemeTokens.Status.onWarm.opacity(0.65) : Color.secondary)
            }
        }
        .padding(.horizontal, Spacing.ll)
        .padding(.vertical, Spacing.ml)
        // Matches Artboard 6's 112px node min-width — `minWidth` is content
        // column geometry, not a control dimension `ui-token-check.mjs`
        // tracks (see that script's SWIFT_VIOLATION comment).
        .frame(minWidth: 112)
        .background(
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .fill(isAccent ? Color.accentColor : Color.secondary.opacity(0.08)),
        )
    }
}
