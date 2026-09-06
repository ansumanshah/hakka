// @generated — do not edit. Synced from ios/Sources/UI/Breakpoints/BreakpointsSections.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - BreakpointsView: Add-rule form / Rules list / Empty state
//
// See BreakpointsView.swift for the split's overview.

extension BreakpointsView {

    // MARK: - Paused section

    var pausedSection: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            HStack(spacing: Theme.s6) {
                Image(systemName: "pause.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.warning)
                Text("Paused (\(paused.count))")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Theme.warning)
            }
            Text("Requests are held until you Resume or Abort. Edit URL or body before resuming.")
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(paused) { entry in
                PausedEntryCard(entry: entry)
            }
        }
        .padding(.horizontal, Theme.s16)
        .padding(.vertical, Theme.s12)
        .overlay(alignment: .bottom) {
            Divider().overlay(Theme.border.opacity(0.5))
        }
    }

    // MARK: - Add breakpoint form

    var addSection: some View {
        VStack(alignment: .leading, spacing: Theme.s10) {
            SectionHeader(title: "New breakpoint")

            VStack(alignment: .leading, spacing: Theme.s4) {
                Text("URL pattern (substring)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.text)
                TextField("/api/checkout", text: $pattern)
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
                    .accessibilityLabel("Breakpoint URL pattern")
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
                Text("Pause on")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.text)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.s6) {
                    ForEach(Self.phaseOptions, id: \.rawValue) { p in
                        HakkaChip(label: p.rawValue, isActive: selectedPhase == p, tone: Theme.accent, mono: false) {
                            selectedPhase = p
                            Haptics.light()
                        }
                        .accessibilityLabel("Select phase \(p.rawValue)")
                    }
                    }
                }
            }

            Button {
                    handleAdd()
                    Haptics.light()
                } label: {
                    Label("Add breakpoint", systemImage: "plus")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(pattern.trimmingCharacters(in: .whitespaces).isEmpty ? Theme.textTertiary : .white)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: Theme.tapMin)
                        .background(pattern.trimmingCharacters(in: .whitespaces).isEmpty ? Theme.border : Theme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                }
                .buttonStyle(.plain)
                .disabled(pattern.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityLabel("Add breakpoint")
        }
        .hakkaGroupedCard()
        .padding(.horizontal, HakkaMetrics.Layout.gutter)
        .padding(.vertical, Theme.s12)
    }

    // MARK: - Rules list

    var rulesSection: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            SectionHeader(title: "Active breakpoints · \(rules.count)")

            ForEach(rules) { rule in
                ruleRow(rule)
            }
        }
        .padding(.horizontal, HakkaMetrics.Layout.gutter)
        .padding(.vertical, Theme.s12)
    }

    private func ruleRow(_ rule: Breakpoint) -> some View {
        VStack(spacing: Theme.s4) {
            // Top: method badge + pattern + remove
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

                Text("bp")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, Theme.s4)
                    .padding(.vertical, HakkaMetrics.Spacing.xxs)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusS).stroke(Theme.border, lineWidth: 0.5))

                Button {
                    BreakpointEngine.shared.removeBreakpoint(id: rule.id)
                    Haptics.light()
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption2)
                        .foregroundStyle(Theme.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove breakpoint \(rule.id)")
            }

            // Bottom: phase label + toggle
            HStack {
                Text("pauses on \(rule.on.rawValue)")
                    .font(.caption2)
                    .foregroundStyle(Theme.textTertiary)
                Spacer()
                inlineToggle(isOn: rule.enabled) {
                    BreakpointEngine.shared.setEnabled(id: rule.id, enabled: !rule.enabled)
                    Haptics.light()
                }
                .accessibilityLabel(rule.enabled ? "Disable breakpoint" : "Enable breakpoint")
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

    // MARK: - Empty state

    var emptyState: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            Text("No breakpoints. Add one above to pause matching requests.")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            Text("Breakpoints pause requests before they reach the network. Inspect the request, edit the URL or body, then Resume (forwarding your edits) or Abort. Everything runs in-process — no proxy or certificate required.")
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
    // Method/Phase chips use the shared `HakkaChip` component (see above) —
    // no local chip skin here.

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
