import AppKit
import SwiftUI

struct ProxyMappingsEditor: View {
    @Binding var mappings: ProxyMappingFile

    var body: some View {
        ForEach($mappings.mapLocal) { $rule in
            VStack(alignment: .leading, spacing: Spacing.sm) {
                TextField("URL expression", text: $rule.match)
                HStack {
                    TextField("Local response file", text: $rule.file)
                    Button("Choose…") {
                        let panel = NSOpenPanel()
                        panel.canChooseDirectories = false
                        if panel.runModal() == .OK, let url = panel.url {
                            rule.file = url.path
                        }
                    }
                    Button("Remove", role: .destructive) { mappings.mapLocal.removeAll { $0.id == rule.id } }
                }
            }
        }
        ForEach($mappings.mapRemote) { $rule in
            VStack(alignment: .leading, spacing: Spacing.sm) {
                TextField("URL expression", text: $rule.match)
                HStack {
                    TextField("Replacement URL", text: $rule.replace)
                    Button("Remove", role: .destructive) { mappings.mapRemote.removeAll { $0.id == rule.id } }
                }
            }
        }
        HStack {
            Button("Add Local Mapping") { mappings.mapLocal.append(ProxyLocalMapping()) }
            Button("Add Remote Mapping") { mappings.mapRemote.append(ProxyRemoteMapping()) }
        }
    }
}
