import SwiftUI

/// Startup-only proxy rule editor. The enclosing capture view disables it while active.
struct ProxyRulesEditor: View {
    @Binding var mappings: ProxyMappingFile

    var body: some View {
        Section("Header rules") {
            ForEach($mappings.headerRules) { $rule in
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    TextField("URL expression", text: $rule.match)
                    Picker("Phase", selection: $rule.phase) {
                        ForEach(ProxyHeaderRule.Phase.allCases) { Text($0.rawValue.capitalized).tag($0) }
                    }
                    Picker("Action", selection: $rule.operation) {
                        Text("Set").tag(ProxyHeaderRule.Operation.set)
                        Text("Remove").tag(ProxyHeaderRule.Operation.remove)
                    }
                    TextField("Header name", text: $rule.name)
                    if rule.operation == .set {
                        TextField("Header value", text: $rule.value)
                    }
                    Button("Remove", role: .destructive) { mappings.headerRules.removeAll { $0.id == rule.id } }
                }
            }
            Button("Add Header Rule") { mappings.headerRules.append(ProxyHeaderRule()) }
        }
        Section("Block rules") {
            ForEach($mappings.blockRules) { $rule in
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    TextField("URL expression", text: $rule.match)
                    TextField("Status", value: $rule.status, format: .number.grouping(.never))
                    TextField("Response body", text: $rule.body)
                    Button("Remove", role: .destructive) { mappings.blockRules.removeAll { $0.id == rule.id } }
                }
            }
            Button("Add Block Rule") { mappings.blockRules.append(ProxyBlockRule()) }
        }
        Section("Delay rules") {
            ForEach($mappings.delayRules) { $rule in
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    TextField("URL expression", text: $rule.match)
                    Picker("Phase", selection: $rule.phase) {
                        ForEach(ProxyHeaderRule.Phase.allCases) { Text($0.rawValue.capitalized).tag($0) }
                    }
                    TextField("Delay (ms)", value: $rule.delayMs, format: .number.grouping(.never))
                    Button("Remove", role: .destructive) { mappings.delayRules.removeAll { $0.id == rule.id } }
                }
            }
            Button("Add Delay Rule") { mappings.delayRules.append(ProxyDelayRule()) }
        }
    }
}
