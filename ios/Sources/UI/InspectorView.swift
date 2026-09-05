#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork

// MARK: - BuiltInTab

/// The five persistent bottom-bar destinations:
/// Network · Stats · Logs · Rules · Storage. Plugin panels are appended after
/// these. Settings is not a tab at all anymore — it's a header gear icon
/// present on every tab (see `onSettings`/`showSettings` below).
///
/// - Logs absorbs Console + Structured as an internal segmented sub-view
///   (`LogsTabView`) instead of spending two top-level tab slots on them.
/// - Stats absorbs the standalone Dashboard sheet — it's a first-class tab
///   like the other three platforms, not reached only via a shortcut button.
/// - Breakpoints and Throttle stay merged into one Rules tab (segmented
///   switch inside `RulesView`) — both shape traffic before it reaches the
///   app, so they don't need separate top-level tabs.
enum InspectorTab: String, CaseIterable {
    case network = "Network"
    case stats   = "Stats"
    case logs    = "Logs"
    case rules   = "Rules"
    case storage = "Storage"

    fileprivate var icon: String {
        switch self {
        case .network: return "antenna.radiowaves.left.and.right"
        case .stats:   return "chart.bar.fill"
        case .logs:    return "list.bullet.rectangle"
        case .rules:   return "wand.and.rays"
        case .storage: return "externaldrive"
        }
    }
}

private typealias BuiltInTab = InspectorTab

// MARK: - InspectorTabID

/// Unified tab identity: either a built-in or a plugin panel.
private enum InspectorTabID: Hashable {
    case builtIn(BuiltInTab)
    case plugin(String) // panel id

    var rawTitle: String {
        switch self {
        case .builtIn(let t): return t.rawValue
        case .plugin(let id): return id
        }
    }
}

// MARK: - InspectorTab (display item)

private struct InspectorTabItem: Identifiable {
    let id: InspectorTabID
    let title: String
    let icon: String
}

// MARK: - InspectorView

/// Root inspector sheet. A tab bar at the bottom switches between the built-in
/// panels and any plugin-contributed panels (appended after built-ins, ordered
/// by ``HakkaPanel/order``).
///
/// Settings is not part of the tab set — it's a header gear icon present on
/// every built-in tab, reached in one tap from anywhere and presented as its
/// own sheet on top of the Inspector.
struct InspectorView: View {
    let onDismiss: () -> Void
    var initialTab: InspectorTab = .network

    @State private var activeID: InspectorTabID
    @State private var showSettings = false

    init(onDismiss: @escaping () -> Void, initialTab: InspectorTab = .network) {
        self.onDismiss = onDismiss
        self.initialTab = initialTab
        self._activeID = State(initialValue: .builtIn(initialTab))
    }

    // Plugin panels sourced from the shared interceptor registry.
    private var pluginPanels: [HakkaPanel] {
        HakkaInterceptor.shared.pluginRegistry.panels
    }

    private var tabs: [InspectorTabItem] {
        let builtIns = BuiltInTab.allCases.map { tab in
            InspectorTabItem(id: .builtIn(tab), title: tab.rawValue, icon: tab.icon)
        }
        let plugins = pluginPanels.map { panel in
            InspectorTabItem(id: .plugin(panel.id), title: panel.title, icon: panel.icon)
        }
        return builtIns + plugins
    }

    var body: some View {
        VStack(spacing: 0) {
            activePanel
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            tabBar
        }
        // Keep interactive content inside the sheet's safe area so the tab
        // bar clears its rounded corners and the home indicator. The surface
        // may still extend to the sheet edge behind it.
        .background(Theme.bg.ignoresSafeArea())
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
    }

    private var onSettings: () -> Void { { showSettings = true } }

    // MARK: - Active panel

    @ViewBuilder
    private var activePanel: some View {
        switch activeID {
        case .builtIn(let tab):
            builtInView(tab)
        case .plugin(let panelID):
            pluginView(panelID: panelID)
        }
    }

    @ViewBuilder
    private func builtInView(_ tab: BuiltInTab) -> some View {
        switch tab {
        case .network:
            RequestListView(onDismiss: onDismiss, onSettings: onSettings)
        case .stats:
            DashboardView(requests: HakkaInterceptor.shared.store.requests, onSettings: onSettings)
        case .logs:
            LogsTabView(onSettings: onSettings)
        case .rules:
            RulesView(onSettings: onSettings)
        case .storage:
            StorageView(onSettings: onSettings)
        }
    }

    @ViewBuilder
    private func pluginView(panelID: String) -> some View {
        if let panel = pluginPanels.first(where: { $0.id == panelID }),
           let builder = panel.viewBuilder {
            builder() // AnyView from plugin
        } else {
            // Fallback: panel registered without a view builder.
            VStack(spacing: Theme.s8) {
                Image(systemName: "puzzlepiece")
                    .font(.largeTitle)
                    .foregroundStyle(Theme.textTertiary)
                Text("Plugin panel")
                    .font(.caption)
                    .foregroundStyle(Theme.textTertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: - Tab Bar
    //
    // Five is the practical ceiling for a bottom tab bar at 375pt width — with
    // no plugin panels registered (the common case) the five built-ins get a
    // fixed, evenly-distributed bar rather than a scrollable one sized to
    // content. Plugin panels still append after the five and fall back to the
    // scrollable layout so third-party panels never get silently clipped
    // off-screen.

    private var tabBar: some View {
        Group {
            if pluginPanels.isEmpty {
                HStack(spacing: 0) {
                    ForEach(tabs) { tab in
                        tabItem(tab)
                            .frame(maxWidth: .infinity)
                    }
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 0) {
                        ForEach(tabs) { tab in
                            tabItem(tab)
                        }
                    }
                    .padding(.horizontal, Theme.s8)
                }
            }
        }
        .background(Theme.surface)
        .overlay(alignment: .top) {
            Divider().overlay(Theme.border)
        }
    }

    private func tabItem(_ tab: InspectorTabItem) -> some View {
        let isActive = activeID == tab.id
        return Button {
            if activeID != tab.id {
                activeID = tab.id
                Haptics.light()
            }
        } label: {
            Image(systemName: tab.icon)
                .font(.system(size: HakkaMetrics.FontSize.xxl, weight: isActive ? .semibold : .regular))
                .foregroundStyle(isActive ? Theme.accent : Theme.textTertiary)
                .frame(
                    width: HakkaMetrics.ControlHeight.bar,
                    height: HakkaMetrics.ControlHeight.bar
                )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

#if DEBUG
#Preview("Inspector — Network") { InspectorView(onDismiss: {}) }
#Preview("Inspector — Logs") {
    HakkaConsole.shared.log(.info, "Preview entry")
    HakkaConsole.shared.log(.warn, "Something to watch")
    return InspectorView(onDismiss: {}, initialTab: .logs)
}
#Preview("Inspector — Stats") { InspectorView(onDismiss: {}, initialTab: .stats) }
#endif
#endif // canImport(UIKit)
