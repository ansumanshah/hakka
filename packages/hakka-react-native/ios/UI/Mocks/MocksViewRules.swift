// @generated — do not edit. Synced from ios/Sources/UI/Mocks/MocksViewRules.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - MocksView: Active rules list / Empty state
//
// See MocksView.swift for the split's overview.

extension MocksView {

    var rulesSection: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            Text("ACTIVE RULES (\(rules.count))")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.textTertiary)
                .kerning(0.5)

            ForEach(rules) { rule in
                ruleRow(rule)
            }
        }
        .padding(.horizontal, Theme.s16)
        .padding(.vertical, Theme.s12)
    }

    private func ruleRow(_ rule: MockRule) -> some View {
        VStack(spacing: Theme.s6) {
            // Top: method badge + pattern + action tag + remove
            HStack(spacing: Theme.s8) {
                Text(rule.method ?? "ANY")
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(rule.method != nil ? Theme.info : Theme.textTertiary)
                    .padding(.horizontal, Theme.s6)
                    .padding(.vertical, HakkaMetrics.Spacing.xxs)
                    .background((rule.method != nil ? Theme.info : Theme.textTertiary).opacity(0.10))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radiusS)
                            .stroke((rule.method != nil ? Theme.info : Theme.textTertiary).opacity(0.40), lineWidth: 1)
                    )

                Text(rule.pattern)
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(rule.action.rawValue.lowercased())
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Theme.s6)
                    .padding(.vertical, HakkaMetrics.Spacing.xxs)
                    .background(actionColor(rule.action))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))

                Button {
                    MockEngine.shared.removeRule(id: rule.id)
                    Haptics.light()
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption2)
                        .foregroundStyle(Theme.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove mock rule \(rule.id)")
            }

            // Bottom: outcome (status/redirect/aborted) + hit count + toggle
            HStack(spacing: Theme.s8) {
                ruleOutcome(rule)
                Text("\(rule.hitCount) \(rule.hitCount == 1 ? "hit" : "hits")")
                    .font(.caption2)
                    .foregroundStyle(Theme.textTertiary)
                if let budget = skipStopLabel(rule) {
                    Text(budget)
                        .font(.caption2)
                        .foregroundStyle(Theme.textTertiary)
                }
                Spacer()
                inlineToggle(isOn: rule.enabled) {
                    if rule.enabled {
                        MockEngine.shared.disableRule(id: rule.id)
                    } else {
                        MockEngine.shared.enableRule(id: rule.id)
                    }
                    Haptics.light()
                }
                .accessibilityLabel(rule.enabled ? "Disable mock rule" : "Enable mock rule")
                .accessibilityAddTraits(rule.enabled ? .isSelected : [])
            }
        }
        .padding(Theme.s10)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusM).stroke(Theme.border, lineWidth: 0.5))
        .opacity(rule.enabled ? 1 : 0.55)
        .animation(.easeOut(duration: 0.15), value: rule.enabled)
    }

    @ViewBuilder
    private func ruleOutcome(_ rule: MockRule) -> some View {
        switch rule.action {
        case .block:
            Text("aborted")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Theme.error)
        case .failure:
            Text(rule.failure?.code.displayName ?? "failure")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Theme.error)
        case .redirect:
            Text("\u{2192} \(rule.redirectTo ?? "")")
                .font(.caption2.monospaced())
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
        case .mock:
            HStack(spacing: Theme.s6) {
                Text("\(rule.response.status)")
                    .font(.caption2.weight(.semibold).monospaced())
                    .foregroundStyle(Theme.statusColor(for: rule.response.status))
                if rule.response.delay > 0 {
                    Text("\(Int(rule.response.delay * 1000))ms")
                        .font(.caption2.monospaced())
                        .foregroundStyle(Theme.textTertiary)
                }
            }
        }
    }

    /// Static skip/stop config label (e.g. "skip 2 · stop after 5") — the
    /// budget's *configuration*, not live progress through it. This panel
    /// reads the same in-process `MockEngine` that owns the counter, so
    /// `hitCount` above is live and accurate; a desktop peer driving this
    /// rule over the control channel has no such visibility (fire-and-
    /// forget, no feedback frame) and must not claim to show live progress.
    private func skipStopLabel(_ rule: MockRule) -> String? {
        var parts: [String] = []
        if rule.skipCount > 0 { parts.append("skip \(rule.skipCount)") }
        if let stopAfter = rule.stopAfter { parts.append("stop after \(stopAfter)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // MARK: - Empty state

    var emptyState: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            Text("No mock rules. Add one above to intercept matching requests.")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            Text("Mocks intercept requests before they reach the network — no request is made. Redirect sends the real request elsewhere; Block aborts with a network error. Everything runs in-process — no proxy or certificate required.")
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .italic()
        }
        .padding(.horizontal, Theme.s16)
        .padding(.top, Theme.s12)
    }

    // MARK: - Reusable components
    //
    // Method/Action chips use the shared `HakkaChip` component (see above) —
    // no local chip skin here. `actionColor` carries no access modifier
    // because `addSection` (MocksViewForm.swift) also colors its action chips.

    func actionColor(_ action: MockRuleAction) -> Color {
        switch action {
        case .mock:     return Theme.accent
        case .redirect: return Theme.warning
        case .block:    return Theme.error
        case .failure:  return Theme.error
        }
    }

    private func inlineToggle(isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule().fill(isOn ? Theme.success : Theme.border).frame(width: HakkaMetrics.ControlHeight.field, height: HakkaMetrics.ControlHeight.chip)
                Circle()
                    .fill(.white)
                    .frame(width: HakkaMetrics.ControlHeight.badge, height: HakkaMetrics.ControlHeight.badge)
                    .padding(.horizontal, HakkaMetrics.Spacing.xxs)
                    .shadow(color: .black.opacity(0.12), radius: 1, y: 1)
            }
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.25, dampingFraction: 0.85), value: isOn)
    }
}
#endif // canImport(UIKit)
