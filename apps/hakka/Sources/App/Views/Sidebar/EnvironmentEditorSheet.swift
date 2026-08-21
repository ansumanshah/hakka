import HakkaCore
import SwiftUI

/// Add/rename environments and edit one environment's variables at a time.
/// Secret values never leave this sheet's `SecureField` masking — matching
/// `EnvironmentVariable.secret`'s contract that they never enter the
/// collection tree.
struct EnvironmentEditorSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if let binding = selectedBinding {
                TextField("Name", text: binding.name)
                    .textFieldStyle(.roundedBorder)
                Divider()
                variablesList(binding)
            } else {
                EmptyStateView(
                    systemImage: "gearshape",
                    title: "No environment",
                    message: "Add one to hold variables like {{baseUrl}} or {{token}}.",
                )
            }
            Spacer(minLength: 0)
            footer
        }
        .padding(20)
        .frame(width: 480, height: 420)
    }

    private var header: some View {
        HStack {
            Text("Environments").font(.headline)
            Spacer()
            Picker("", selection: pickerSelection) {
                ForEach(model.environment.environments) { Text($0.name).tag(String?.some($0.id)) }
            }
            .labelsHidden()
            .frame(maxWidth: 160)
            Button { model.environment.addEnvironment() } label: {
                Image(systemName: "plus")
            }
        }
    }

    private func variablesList(_ binding: Binding<RequestEnvironment>) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(binding.variables) { $variable in
                    HStack(spacing: 8) {
                        KeyValueEditorRow(
                            name: $variable.name,
                            value: $variable.value,
                            enabled: $variable.enabled,
                            isSecret: variable.secret,
                            onDelete: { binding.wrappedValue.variables.removeAll { $0.id == variable.id } },
                        )
                        Button {
                            $variable.secret.wrappedValue.toggle()
                        } label: {
                            Image(systemName: variable.secret ? "lock.fill" : "lock.open")
                        }
                        .buttonStyle(.plain)
                        .help("Secret")
                    }
                    .padding(.vertical, 4)
                    Divider()
                }
                Button {
                    binding.wrappedValue.variables.append(EnvironmentVariable(name: "", value: ""))
                } label: {
                    Label("Add Variable", systemImage: "plus")
                }
                .buttonStyle(.plain)
                .padding(.top, 8)
            }
        }
    }

    private var footer: some View {
        HStack {
            Spacer()
            Button("Close") { dismiss() }
            Button("Save") {
                Task {
                    if let directory = model.collection.directoryURL {
                        await model.environment.save(forCollectionAt: directory)
                    }
                    dismiss()
                }
            }
            .keyboardShortcut(.defaultAction)
        }
    }

    private var selectedBinding: Binding<RequestEnvironment>? {
        guard let id = model.environment.selectedID,
              let index = model.environment.environments.firstIndex(where: { $0.id == id })
        else { return nil }
        return Binding(
            get: { model.environment.environments[index] },
            set: { model.environment.update($0) },
        )
    }

    private var pickerSelection: Binding<String?> {
        Binding(get: { model.environment.selectedID }, set: { model.environment.selectedID = $0 })
    }
}
