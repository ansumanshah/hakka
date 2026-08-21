#if canImport(UIKit)
import SwiftUI
import HakkaCommon

// MARK: - MocksView: Failure + skip/stop form fields
//
// Split out of MocksViewForm.swift to keep files under 200 lines. See
// MocksView.swift for the split's overview.

extension MocksView {

    /// Failure-code picker — the one field a `failure` rule needs. Simulates
    /// a specific transport error (timeout, no connection, …) rather than
    /// `block`'s generic "not connected" — see `MockFailureCode`.
    var failureFields: some View {
        VStack(alignment: .leading, spacing: Theme.s4) {
            Text("Failure")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.text)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.s6) {
                    ForEach(MockFailureCode.allCases, id: \.self) { code in
                        HakkaChip(
                            label: code.displayName,
                            isActive: selectedFailureCode == code,
                            tone: Theme.error,
                            mono: false
                        ) {
                            selectedFailureCode = code
                            Haptics.light()
                        }
                        .accessibilityLabel("Select failure \(code.displayName)")
                    }
                }
            }
            Text("Matching requests fail as if the transport itself broke — no real response, no server call.")
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
                .italic()
        }
    }

    /// `skipCount`/`stopAfter` — applies to every action, not just `mock`.
    /// The desktop's Rules panel cannot show live progress against these
    /// (device-side counter, no feedback frame) — see
    /// `RuleEntry.hitCount`'s doc in `apps/hakka`; this on-device panel CAN,
    /// since it reads the same `MockEngine` instance that counts hits.
    var skipStopFields: some View {
        VStack(alignment: .leading, spacing: Theme.s4) {
            Text("Skip / stop (optional)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.text)
            HStack(spacing: Theme.s10) {
                VStack(alignment: .leading, spacing: Theme.s4) {
                    Text("Skip first N matches")
                        .font(.caption2)
                        .foregroundStyle(Theme.textTertiary)
                    TextField("0", text: $skipCountText)
                        .keyboardType(.numberPad)
                        .font(.caption.monospaced())
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, Theme.s8)
                        .padding(.vertical, Theme.s6)
                        .background(Theme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                        .frame(width: 90)
                        .accessibilityLabel("Skip this many matches before applying")
                }
                VStack(alignment: .leading, spacing: Theme.s4) {
                    Text("Stop after N applies")
                        .font(.caption2)
                        .foregroundStyle(Theme.textTertiary)
                    TextField("unlimited", text: $stopAfterText)
                        .keyboardType(.numberPad)
                        .font(.caption.monospaced())
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, Theme.s8)
                        .padding(.vertical, Theme.s6)
                        .background(Theme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                        .frame(width: 90)
                        .accessibilityLabel("Stop applying after this many matches")
                }
            }
        }
    }
}
#endif // canImport(UIKit)
