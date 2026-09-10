import SwiftUI

/// Traffic scope controls belong with traffic search, without changing capture.
struct TrafficFocusMenu: View {
    @Environment(AppModel.self) private var model
    @State private var isPresentingManager = false

    var body: some View {
        Menu {
            Button("All Traffic") { model.traffic.noiseScope.apply(nil) }
            ForEach(model.traffic.noiseScope.focusSets) { set in
                Button { model.traffic.noiseScope.apply(set) } label: {
                    Label(set.name, systemImage: model.traffic.noiseScope.activeFocusSet?.id == set.id ? "checkmark" : "scope")
                }
            }
            Divider()
            Button("Manage Focus & Noise…") { isPresentingManager = true }
        } label: {
            Label("Focus", systemImage: "scope")
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .help(model.traffic.noiseScope.activeFocusSet?.name ?? "Focus and noise filters")
        .sheet(isPresented: $isPresentingManager) {
            FocusNoiseManagerSheet(scope: model.traffic.noiseScope)
        }
    }
}
