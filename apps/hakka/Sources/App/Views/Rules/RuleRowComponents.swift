import HakkaCommon
import SwiftUI

/// The two small pieces `RuleRowView`'s anatomy needs that nothing else in
/// the app has yet: an outlined, per-method-hued chip (rule editors are the
/// one place DESIGN.md's row-vs-control carve-out allows a method chip — the
/// traffic list keeps method as plain colored text) and a pill badge for the
/// hit counter (previously a plain caption, which read as metadata rather
/// than the small live number it actually is).

/// A method label as an outlined chip, colored per `Fmt.methodColor(for:)`.
/// `method == nil` (a rule with no method filter) shows "ANY" in the
/// neutral tone the same lookup already gives an unrecognized string.
struct MethodChipView: View {
    let method: String?

    private var label: String { method?.uppercased() ?? "ANY" }
    private var color: Color { Fmt.methodColor(for: method) }

    var body: some View {
        Text(label)
            .font(.caption2.monospaced().weight(.bold))
            .foregroundStyle(color)
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, Spacing.xs)
            .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.md)
                    .stroke(color.opacity(0.4), lineWidth: 1)
            )
            .accessibilityLabel(method.map { "\($0) method" } ?? "Any method")
    }
}

/// A live count as a pill badge — mono digits on a neutral fill, matching
/// `DeviceTagView`'s pill construction (`Capsule`, hairline vertical
/// padding) rather than a plain caption, since a hit count is a small
/// number worth reading at a glance, not a footnote.
struct HitCountBadgeView: View {
    let count: Int

    var body: some View {
        Text("\(count)")
            .font(.caption2.monospaced().weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, Spacing.xs)
            .padding(.vertical, 1)  // hairline — matches DeviceTagView's pill, and 1 is an allowed value
            .background(Color.secondary.opacity(0.1), in: Capsule())
            .accessibilityLabel(count == 1 ? "1 hit" : "\(count) hits")
    }
}
