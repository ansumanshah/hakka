import HakkaUI
import SwiftUI

/// Shown in the center pane before any request or the Traffic section is
/// selected. Reuses `HakkaUI.AppIcon` — the one HakkaUI view that is not
/// gated behind `#if canImport(UIKit)`; every inspector view in that module
/// is iOS-only (see `.claude/rules/swiftui-patterns.md`), so it is otherwise
/// rebuilt natively for this app rather than reused.
struct WelcomeView: View {
    var body: some View {
        VStack(spacing: 16) {
            AppIcon()
                .frame(width: 72, height: 72)
            Text("Hakka")
                .font(.title2.weight(.semibold))
            Text("Select a request, or start capturing live traffic.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
