// @generated — do not edit. Synced from ios/Sources/UI/Breakpoints/BreakpointsView.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - BreakpointsView
//
// The panel is split across sibling files in this directory (mirroring the
// `BubbleWindow*` / `DashboardView*` splits elsewhere in this module):
//   - BreakpointsView.swift         — this file: stored state + top-level layout
//   - BreakpointsSections.swift     — add-rule form, rules list, empty state
//   - BreakpointsPausedCards.swift  — paused request/response cards + their helpers
//
// Stored properties and the constants/logic the sibling files touch carry no
// access modifier (internal) — that's the price of the split, not a design
// change, same trade `BubbleWindow.swift` documents at its own declaration.

/// Breakpoints panel — mirrors BreakpointsTab (web) and BreakpointsPanel (RN).
///
/// Shows:
/// - Paused requests (prominent, shown first) with Resume / Abort / edit controls.
/// - Add-breakpoint form: URL pattern, method chip-row, phase chip-row.
/// - Active breakpoints list with enable toggle and remove button.
@MainActor
struct BreakpointsView: View {

    // MARK: - Constants

    static let methodOptions: [String] = ["ANY", "GET", "POST", "PUT", "PATCH", "DELETE"]
    static let phaseOptions: [BreakpointPhase] = BreakpointPhase.allCases

    // MARK: - State

    /// Hidden when embedded under the Rules segmented switch, which already
    /// shows the section title — avoids a duplicate header there.
    var showToolbar: Bool = true

    @State var rules: [Breakpoint] = []
    @State var paused: [PausedEntry] = []

    // Add-rule form
    @State var pattern: String = ""
    @State var selectedMethod: String = "ANY"
    @State var selectedPhase: BreakpointPhase = .request

    @State private var unsubscribe: (() -> Void)?

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            if showToolbar {
                toolbar
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if !paused.isEmpty {
                        pausedSection
                    }
                    addSection
                    if !rules.isEmpty {
                        rulesSection
                    } else {
                        emptyState
                    }
                }
                .padding(.bottom, Theme.s20)
            }
            .scrollIndicators(.hidden)
        }
        .hakkaPageCanvas()
        .onAppear {
            refresh()
            let token = BreakpointEngine.shared.subscribe { [self] in
                Task { @MainActor in refresh() }
            }
            unsubscribe = token
        }
        .onDisappear {
            unsubscribe?()
            unsubscribe = nil
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: Theme.s8) {
            Image(systemName: "pause.circle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)
            Text("Breakpoints")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.text)
            Spacer()
            if !rules.isEmpty {
                Button {
                    BreakpointEngine.shared.clearBreakpoints()
                    Haptics.light()
                } label: {
                    Text("Clear all")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .buttonStyle(.plain)
            }
        }
        .hakkaInspectorToolbar()
    }

    // MARK: - Logic

    private func refresh() {
        rules = BreakpointEngine.shared.getBreakpoints()
        paused = BreakpointEngine.shared.getPaused()
    }

    /// Called from `addSection` (BreakpointsSections.swift) on submit/tap.
    func handleAdd() {
        let p = pattern.trimmingCharacters(in: .whitespaces)
        guard !p.isEmpty else { return }
        BreakpointEngine.shared.addBreakpoint(BreakpointInput(
            pattern: p,
            method: selectedMethod == "ANY" ? nil : selectedMethod,
            on: selectedPhase,
            enabled: true
        ))
        pattern = ""
        selectedMethod = "ANY"
        selectedPhase = .request
    }
}

#if DEBUG
#Preview("Breakpoints — empty") { BreakpointsView() }
#Preview("Breakpoints — with rules") {
    let _ = BreakpointEngine.shared.addBreakpoint(BreakpointInput(
        pattern: "/api/checkout",
        method: "POST",
        on: .request,
        enabled: true
    ))
    let _ = BreakpointEngine.shared.addBreakpoint(BreakpointInput(
        pattern: "/api/users",
        on: .both,
        enabled: false
    ))
    return BreakpointsView()
}
#endif
#endif // canImport(UIKit)
