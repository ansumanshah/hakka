import SwiftUI

/// Edits the two persisted lenses separately: Focus Sets narrow an
/// investigation; noise controls keep known chatty domains out of every set.
struct FocusNoiseManagerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let scope: NoiseScopeStore

    @State private var name = ""
    @State private var domains = ""
    @State private var pathPrefix = ""
    @State private var methods = ""
    @State private var mutedDomain = ""

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section("Active Focus") {
                    LabeledContent("Showing") {
                        Text(activeFocusLabel)
                    }
                    Button("Clear Focus") { scope.apply(nil) }
                        .disabled(scope.activeFocusSet == nil)
                }

                Section("Saved Focus Sets") {
                    if scope.focusSets.isEmpty {
                        Text("Save a domain, path, or method scope to reuse it here.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(scope.focusSets) { set in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(set.name)
                                Text(set.summary).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(scope.activeFocusSet?.id == set.id ? "Active" : "Apply") { scope.apply(set) }
                                .disabled(scope.activeFocusSet?.id == set.id)
                            Button(role: .destructive) { scope.delete(set) } label: {
                                Image(systemName: "trash")
                            }
                            .accessibilityLabel("Delete \(set.name)")
                        }
                    }
                }

                Section("Save Focus Set") {
                    TextField("Name", text: $name)
                    TextField("Domains, comma-separated", text: $domains)
                    Text("Matches exact domains and their subdomains.").font(.caption).foregroundStyle(.secondary)
                    TextField("Path prefix, optional", text: $pathPrefix)
                    TextField("Methods, comma-separated", text: $methods)
                    Button("Save and Apply") {
                        guard let set = scope.saveFocusSet(name: name, domains: commaSeparated(domains), pathPrefix: pathPrefix, methods: commaSeparated(methods)) else { return }
                        scope.apply(set)
                        name = ""
                        domains = ""
                        pathPrefix = ""
                        methods = ""
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || allCriteriaEmpty)
                }

                Section("Noise Controls") {
                    if scope.excludeRules.isEmpty {
                        Text("Muted domains stay captured but are hidden from every Focus Set.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(scope.excludeRules) { rule in
                        HStack {
                            Text(rule.host)
                            Spacer()
                            Button("Unmute") { scope.unmute(rule) }
                        }
                    }
                    HStack {
                        TextField("Domain to mute", text: $mutedDomain)
                        Button("Mute") {
                            scope.mute(host: mutedDomain)
                            mutedDomain = ""
                        }
                        .disabled(mutedDomain.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            Divider()
            HStack {
                Button("Reset Focus & Noise", role: .destructive) { scope.clear() }
                    .disabled(!scope.isActive)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding()
        }
        .frame(minWidth: 540, minHeight: 620) // ui-token-check-ignore: resizable sheet minimum
    }

    private var allCriteriaEmpty: Bool {
        commaSeparated(domains).isEmpty
            && pathPrefix.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && commaSeparated(methods).isEmpty
    }

    private var activeFocusLabel: String {
        if let focus = scope.activeFocusSet {
            return focus.name
        }
        return scope.includeRules.isEmpty ? "All Traffic" : "Custom scope"
    }

    private func commaSeparated(_ value: String) -> [String] {
        value.split(separator: ",").map(String.init)
    }
}
