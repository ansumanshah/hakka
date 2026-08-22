import HakkaCommon
import SwiftUI

/// The sheet's "Matches / Serves" summary: an editable match (method + URL
/// pattern, prefilled from `CapturedMockConverter`) above a read-only
/// summary of what the frozen response serves back, plus the two notes the
/// artboard carries — query-string handling and replace-by-id semantics.
/// Split out of `PromoteMockSheet` to keep both files under 200 lines.
struct PromoteMockMatchCard: View {
    @Binding var draft: PromoteMockDraft

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: 0) {
                matchRow
                Divider()
                servesRow
                Divider()
                queryStringRow
            }
            .padding(Spacing.lg)
            .background(Color.secondary.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))

            replaceNote
        }
    }

    private var matchRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            rowLabel("Matches")
            TextField("Method", text: $draft.method)
                .font(.system(size: FontSize.xs, weight: .bold, design: .monospaced))
                .foregroundStyle(Fmt.methodColor(HttpMethod(rawString: draft.method)))
                .textFieldStyle(.roundedBorder)
                .frame(width: 76)
                .accessibilityLabel("Match method")
            TextField("scheme://host/path", text: $draft.pattern)
                .font(.system(size: FontSize.sm, design: .monospaced))
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Match URL pattern")
        }
        .padding(.vertical, Spacing.sm)
    }

    private var servesRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            rowLabel("Serves")
            Text(String(draft.status))
                .font(.system(size: FontSize.sm, weight: .bold, design: .monospaced))
                .foregroundStyle(Fmt.statusColor(draft.status))
            Text(servesSummary)
                .font(.system(size: FontSize.sm))
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.vertical, Spacing.sm)
    }

    private var queryStringRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            rowLabel("Query string")
            Text("dropped, matches the endpoint rather than one query")
                .font(.system(size: FontSize.sm))
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.vertical, Spacing.sm)
    }

    /// True today: `RuleStore.add` replaces any entry sharing the resolved
    /// match's id (`CapturedMockConverter.ruleID(method:pattern:)`), and the
    /// install path always resolves the id from the (possibly edited) match
    /// this card holds — see `RuleStore.swift`'s `add(_:id:)` doc. Reflects
    /// that reality rather than assuming the artboard's claim held.
    private var replaceNote: some View {
        Label(
            "Re-mocking this request replaces the rule instead of adding a second one.",
            systemImage: "arrow.triangle.2.circlepath"
        )
        .font(.system(size: FontSize.xs))
        .foregroundStyle(.tertiary)
    }

    private var servesSummary: String {
        var parts: [String] = []
        if let contentType = draft.contentType, !contentType.isEmpty { parts.append(contentType) }
        parts.append(Fmt.bytes(draft.bodySize))
        return parts.joined(separator: " · ")
    }

    private func rowLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: FontSize.xs, weight: .medium))
            .foregroundStyle(.tertiary)
            .frame(width: 96, alignment: .leading)
    }
}
