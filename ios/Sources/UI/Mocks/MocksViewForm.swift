#if canImport(UIKit)
import SwiftUI
import HakkaCommon

// MARK: - MocksView: Add mock rule form
//
// See MocksView.swift for the split's overview.

extension MocksView {

    var addSection: some View {
        VStack(alignment: .leading, spacing: Theme.s10) {
            SectionHeader(title: "New mock rule")

            VStack(alignment: .leading, spacing: Theme.s4) {
                Text("URL pattern (substring)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.text)
                TextField("/api/users", text: $pattern)
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.text)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.done)
                    .onSubmit { handleAdd() }
                    .padding(.horizontal, Theme.s8)
                    .padding(.vertical, Theme.s6)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                    .accessibilityLabel("Mock rule URL pattern")
            }

            // Method chips — shared outlined chip component (DESIGN.md: one
            // chip grammar everywhere, not a second filled-solid skin here).
            VStack(alignment: .leading, spacing: Theme.s4) {
                Text("Method")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.text)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.s6) {
                        ForEach(Self.methodOptions, id: \.self) { m in
                            HakkaChip(label: m, isActive: selectedMethod == m, tone: Theme.accent) {
                                selectedMethod = m
                                Haptics.light()
                            }
                            .accessibilityLabel("Select method \(m)")
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: Theme.s4) {
                Text("Action")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.text)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.s6) {
                    ForEach(Self.actionOptions, id: \.self) { a in
                        HakkaChip(label: a.rawValue, isActive: selectedAction == a, tone: actionColor(a), mono: false) {
                            selectedAction = a
                            Haptics.light()
                        }
                        .accessibilityLabel("Select action \(a.rawValue)")
                    }
                    }
                }
            }

            switch selectedAction {
            case .mock:     mockFields
            case .redirect: redirectFields
            case .block:    blockHint
            case .failure:  failureFields
            }

            skipStopFields

            Button {
                    handleAdd()
                    Haptics.light()
                } label: {
                    Label("Add mock rule", systemImage: "plus")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(isAddEnabled ? .white : Theme.textTertiary)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: Theme.tapMin)
                        .background(isAddEnabled ? Theme.accent : Theme.border)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                }
                .buttonStyle(.plain)
                .disabled(!isAddEnabled)
                .accessibilityLabel("Add mock rule")
        }
        .hakkaGroupedCard()
        .padding(.horizontal, HakkaMetrics.Layout.gutter)
        .padding(.vertical, Theme.s12)
    }

    /// Status + delay + body — fields for a straight `mock` rule.
    private var mockFields: some View {
        VStack(alignment: .leading, spacing: Theme.s10) {
            HStack(spacing: Theme.s10) {
                VStack(alignment: .leading, spacing: Theme.s4) {
                    Text("Status")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.text)
                    TextField("200", text: $status)
                        .keyboardType(.numberPad)
                        .font(.caption.monospaced())
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, Theme.s8)
                        .padding(.vertical, Theme.s6)
                        .background(Theme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                        .frame(width: 80)
                        .accessibilityLabel("Response status code")
                }
                VStack(alignment: .leading, spacing: Theme.s4) {
                    Text("Delay (ms)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.text)
                    TextField("0", text: $delayMs)
                        .keyboardType(.numberPad)
                        .font(.caption.monospaced())
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, Theme.s8)
                        .padding(.vertical, Theme.s6)
                        .background(Theme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                        .frame(width: 80)
                        .accessibilityLabel("Response delay in milliseconds")
                }
            }
            VStack(alignment: .leading, spacing: Theme.s4) {
                Text("Response body")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.text)
                TextEditor(text: $responseBody)
                    .font(.system(size: HakkaMetrics.FontSize.sm, design: .monospaced))
                    .foregroundStyle(Theme.text)
                    .scrollContentBackground(.hidden)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusM).stroke(Theme.border, lineWidth: 0.5))
                    .frame(minHeight: 60, maxHeight: 100)  // ui-token-check-ignore: multi-line editor bounds — content box, not a control
                    .accessibilityLabel("Response body")
            }
        }
    }

    /// Target URL — the one field a `redirect` (Map Remote) rule needs.
    private var redirectFields: some View {
        VStack(alignment: .leading, spacing: Theme.s4) {
            Text("Target URL")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.text)
            TextField("https://staging.example.com/api/users", text: $targetURL)
                .font(.caption.monospaced())
                .foregroundStyle(Theme.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.done)
                .onSubmit { handleAdd() }
                .padding(.horizontal, Theme.s8)
                .padding(.vertical, Theme.s6)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                .accessibilityLabel("Redirect target URL")
        }
    }

    private var blockHint: some View {
        Text("Matching requests are aborted with a network error before reaching the server.")
            .font(.caption2)
            .foregroundStyle(Theme.textTertiary)
            .italic()
    }
}
#endif // canImport(UIKit)
