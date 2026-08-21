import SwiftUI

/// Sidebar-embedded environment switcher. Variable editing itself lives in
/// `EnvironmentEditorSheet` — a picker row is not the place to host a
/// multi-field form.
struct EnvironmentPickerView: View {
    @Environment(AppModel.self) private var model
    @State private var showingEditor = false

    var body: some View {
        HStack {
            Picker("Environment", selection: pickerSelection) {
                Text("None").tag(String?.none)
                ForEach(model.environment.environments) { environment in
                    Text(environment.name).tag(String?.some(environment.id))
                }
            }
            .labelsHidden()
            Button {
                showingEditor = true
            } label: {
                Image(systemName: "slider.horizontal.3")
            }
            .buttonStyle(.plain)
            .help("Edit environments")
        }
        .sheet(isPresented: $showingEditor) {
            EnvironmentEditorSheet()
        }
    }

    private var pickerSelection: Binding<String?> {
        Binding(get: { model.environment.selectedID }, set: { model.environment.selectedID = $0 })
    }
}
