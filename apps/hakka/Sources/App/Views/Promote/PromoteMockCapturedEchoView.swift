import HakkaCommon
import SwiftUI

/// The faded echo of the captured row this sheet was opened from — proves
/// the provenance the artboard's comment calls out: this is not a form
/// being filled in, it's a response the app already received, byte for
/// byte, now being frozen. See `.claude/design/gen.py`'s "Promote to mock"
/// section (artboard 7) for the source design.
struct PromoteMockCapturedEchoView: View {
    let method: String
    let path: String
    let status: Int?
    let durationMs: Int64?
    let capturedAt: Date

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("CAPTURED \(Fmt.relativeTime(from: capturedAt).uppercased())")
                .font(.system(size: FontSize.xxs, weight: .semibold))
                .tracking(0.4)
                .foregroundStyle(.tertiary)

            HStack(spacing: Spacing.md) {
                Text(method)
                    .font(.system(size: FontSize.xs, weight: .bold, design: .monospaced))
                    .foregroundStyle(Fmt.methodColor(HttpMethod(rawString: method)))
                Text(path)
                    .font(.system(size: FontSize.xs, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: Spacing.sm)
                Text(status.map(String.init) ?? "–")
                    .font(.system(size: FontSize.xs, weight: .bold, design: .monospaced))
                    .foregroundStyle(Fmt.statusColor(status))
                Text(Fmt.duration(durationMs))
                    .font(.system(size: FontSize.xs, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, Spacing.lg)
            .frame(height: ControlHeight.md)
            .background(Color.secondary.opacity(0.06))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.secondary.opacity(0.15)))
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            .opacity(0.8)

            Label("Frozen exactly as captured", systemImage: "arrow.down")
                .font(.system(size: FontSize.xs))
                .foregroundStyle(.tertiary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Captured \(Fmt.relativeTime(from: capturedAt)): \(method) \(path), status \(status.map(String.init) ?? "unknown")")
    }
}
