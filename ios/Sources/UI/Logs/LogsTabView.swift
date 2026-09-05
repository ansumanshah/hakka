#if canImport(UIKit)
import SwiftUI
import HakkaCommon

// MARK: - LogsSection

/// Logs absorbs Console (unstructured) and Structured (`LogEntry`) as an
/// internal segmented sub-view instead of spending two top-level tab slots
/// on them — matches web's "Console / Structured" segmented control inside
/// its one Logs tab.
enum LogsSection: String, CaseIterable {
    case console = "Console"
    case structured = "Structured"
}

// MARK: - LogsTabView

/// Root Logs panel — segmented switch (Console | Structured) at the top,
/// active section below. Mirrors `RulesView`'s Breakpoints/Throttle pattern.
struct LogsTabView: View {
    var onSettings: () -> Void = {}

    @State private var section: LogsSection = .console

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            segmentedSwitch
            switch section {
            case .console:
                ConsoleView(showToolbar: false)
            case .structured:
                LogsView(showToolbar: false)
            }
        }
        .hakkaPageCanvas()
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: Theme.s8) {
            Image(systemName: "list.bullet.rectangle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)
            Text("Logs")
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
    // Same outlined chip component as the Network filter bar and Rules
    // segmented switch (DESIGN.md: one chip grammar everywhere).

    private var segmentedSwitch: some View {
        HStack(spacing: Theme.s6) {
            ForEach(LogsSection.allCases, id: \.self) { s in
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
#Preview("Logs — Console") { LogsTabView() }
#endif
#endif // canImport(UIKit)
