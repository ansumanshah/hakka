import SwiftUI

/// Desktop settings.
struct SettingsView: View {
    var body: some View {
        Form {
            MCPSettingsSection()
        }
        .formStyle(.grouped)
        .padding(Spacing.lg)
        .frame(width: 480)  // ui-token-check-ignore: window chrome
    }
}
