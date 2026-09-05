// @generated — do not edit. Synced from ios/Sources/UI/Rules/RulesView.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - RulesSection

/// The traffic-shaping panels merged under one Rules tab. All three shape
/// traffic before it reaches the app, so they share a segmented switcher
/// instead of spending separate top-level tabs (mirrors RulesTab on web).
/// Order and labels are pinned to web's `RulesTab.tsx` and RN's `RulesPanel.tsx`
/// — Mock first, singular — so the segmented switch reads identically on all
/// four platforms.
enum RulesSection: String, CaseIterable {
    case mocks       = "Mock"
    case breakpoints = "Breakpoints"
    case throttle    = "Throttle"
}

// MARK: - RulesView

/// Root Rules panel — segmented switch (Mock | Breakpoints | Throttle) at
/// the top, active section below. The active section does not persist
/// across app launches (module-level default), mirroring the web RulesTab
/// behaviour.
struct RulesView: View {
    var onSettings: () -> Void = {}

    @State private var section: RulesSection = .mocks

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            segmentedSwitch
            switch section {
            case .breakpoints:
                BreakpointsView(showToolbar: false)
            case .throttle:
                ThrottleView(showToolbar: false)
            case .mocks:
                MocksView(showToolbar: false)
            }
        }
        .background(Theme.bg)
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: Theme.s8) {
            Image(systemName: "wand.and.rays")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)
            Text("Rules")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.text)
            Spacer()
            Button(action: onSettings) {
                Image(systemName: "gearshape")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Settings")
        }
        .hakkaInspectorToolbar()
    }

    // MARK: - Segmented Switch
    //
    // Same outlined chip component as the Network filter bar (DESIGN.md: one
    // chip grammar everywhere) — no separate filled-solid segmented skin.

    private var segmentedSwitch: some View {
        HStack(spacing: Theme.s6) {
            ForEach(RulesSection.allCases, id: \.self) { s in
                HakkaChip(label: s.rawValue, isActive: section == s, tone: Theme.accent, mono: false) {
                    withAnimation(.easeInOut(duration: 0.15)) { section = s }
                    Haptics.light()
                }
                .accessibilityAddTraits(section == s ? .isSelected : [])
            }
            Spacer()
        }
        .padding(.horizontal, Theme.s16)
        .padding(.bottom, Theme.s8)
    }
}

#if DEBUG
#Preview("Rules — Breakpoints") { RulesView() }
#endif
#endif // canImport(UIKit)
