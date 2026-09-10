import SwiftUI

/// Desktop settings.
struct SettingsView: View {
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.system

    var body: some View {
        Form {
            Section("Appearance") {
                Picker("Theme", selection: $appearance) {
                    ForEach(AppAppearance.allCases) { appearance in
                        Text(appearance.rawValue).tag(appearance)
                    }
                }
                .pickerStyle(.segmented)
            }
            MCPSettingsSection()
        }
        .formStyle(.grouped)
        .padding(Spacing.lg)
        .frame(width: 480)  // ui-token-check-ignore: window chrome
    }
}
