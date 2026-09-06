// @generated — do not edit. Synced from ios/Sources/UI/Mocks/MocksView.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - MockRuleAction
//
// The panel is split across sibling files in this directory (mirroring the
// `BreakpointsView*` split under `Breakpoints/`):
//   - MocksView.swift       — this file: enum/state + top-level layout + logic
//   - MocksViewForm.swift   — add-rule form (URL, method, action, fields)
//   - MocksViewRules.swift  — active-rules list, row, empty state
//
// Stored properties and the constants/logic the sibling files touch carry no
// access modifier (internal) — that's the price of the split, not a design
// change, same trade `BubbleWindow.swift` documents at its own declaration.

/// UI-level classification derived from a `MockRule`'s `block`/`redirectTo`
/// flags — mirrors the action picker on web (`MockTab.tsx`) and RN
/// (`Mocks.tsx`). Not stored on the engine; a rule created here carries
/// exactly the flag combination that reproduces it (see `handleAdd`).
enum MockRuleAction: String, CaseIterable {
    case mock = "Mock"
    case redirect = "Redirect"
    case block = "Block"
    case failure = "Failure"
}

extension MockRule {
    var action: MockRuleAction {
        if failure != nil { return .failure }
        if block { return .block }
        if redirectTo != nil { return .redirect }
        return .mock
    }
}

// MARK: - MocksView

/// Mock rules panel — mirrors MockTab (web) and Mocks (RN).
///
/// Shows an add-rule form (URL pattern, method chips, action chips, then
/// action-specific fields) and the active-rules list with per-rule enable
/// toggle, hit count, and delete. This is where a rule created by "Mock
/// this" (`DetailHelpers.swift`) becomes visible and manageable — closing
/// the loop that comment describes.
@MainActor
struct MocksView: View {

    // MARK: - Constants

    static let methodOptions: [String] = ["ANY", "GET", "POST", "PUT", "PATCH", "DELETE"]
    static let actionOptions: [MockRuleAction] = MockRuleAction.allCases

    // MARK: - State

    /// Hidden when embedded under the Rules segmented switch, which already
    /// shows the section title — avoids a duplicate header there.
    var showToolbar: Bool = true

    @State var rules: [MockRule] = []

    // Add-rule form
    @State var pattern: String = ""
    @State var selectedMethod: String = "ANY"
    @State var selectedAction: MockRuleAction = .mock
    @State var status: String = "200"
    @State var responseBody: String = "{}"
    @State var delayMs: String = "0"
    @State var targetURL: String = ""
    @State var selectedFailureCode: MockFailureCode = .timeout
    /// Skip/stop budget fields, entered as text like `status`/`delayMs`.
    /// Empty parses as "not set" (skipCount 0 / stopAfter unlimited) —
    /// see `handleAdd`.
    @State var skipCountText: String = ""
    @State var stopAfterText: String = ""

    @State private var unsubscribe: (() -> Void)?

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            if showToolbar {
                toolbar
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
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
            let token = MockEngine.shared.subscribe { [self] in
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
            Image(systemName: "theatermasks")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)
            Text("Mocks")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.text)
            Spacer()
            if !rules.isEmpty {
                Button {
                    MockEngine.shared.clearRules()
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

    /// Used by `addSection` (MocksViewForm.swift) to gate/style the Add button.
    var isAddEnabled: Bool {
        guard !pattern.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        if selectedAction == .redirect {
            return !targetURL.trimmingCharacters(in: .whitespaces).isEmpty
        }
        return true
    }

    private func refresh() {
        rules = MockEngine.shared.getRules()
    }

    // handleAdd() lives in MocksViewAdd.swift — split out to keep this file
    // under 200 lines.
}

#if DEBUG
#Preview("Mocks — empty") { MocksView() }
#Preview("Mocks — with rules") {
    let _ = MockEngine.shared.addRule(MockRuleInput(
        pattern: "/api/users",
        method: "GET",
        response: MockResponse(status: 200, body: "{\"users\":[]}")
    ))
    let _ = MockEngine.shared.addRule(MockRuleInput(
        pattern: "/api/checkout",
        method: "POST",
        response: MockResponse(status: 200),
        enabled: true,
        redirectTo: "https://staging.example.com/api/checkout"
    ))
    let _ = MockEngine.shared.addRule(MockRuleInput(
        pattern: "/api/legacy",
        response: MockResponse(status: 0),
        enabled: false,
        block: true
    ))
    return MocksView()
}
#endif
#endif // canImport(UIKit)
