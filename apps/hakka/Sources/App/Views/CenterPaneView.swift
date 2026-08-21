import SwiftUI

/// Center column: the request editor when a collection request is selected,
/// the live traffic list when the Traffic section is, a welcome state
/// otherwise.
struct CenterPaneView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.selection {
        case .request:
            if model.editor.draft != nil {
                RequestEditorContainerView()
            } else {
                EmptyStateView(systemImage: "questionmark.circle", title: "Request not found")
            }
        case .traffic:
            LiveTrafficListView()
        case .rules:
            RulesView()
        case .folderRun:
            EmptyStateView(systemImage: "checklist", title: "Folder Run", message: "Results are in the detail pane.")
        case nil:
            WelcomeView()
        }
    }
}
