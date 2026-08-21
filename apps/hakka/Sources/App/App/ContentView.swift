import SwiftUI

/// Root three-pane layout: collection/traffic sidebar, request editor or
/// live traffic in the center, response/inspection detail on the right —
/// SwiftUI's `NavigationSplitView` is the modern equivalent of a manual
/// `NSSplitView` and gets resizable, collapsible columns for free.
struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 380)
        } content: {
            CenterPaneView()
                .navigationSplitViewColumnWidth(min: 380, ideal: 480)
        } detail: {
            DetailPaneView()
                .navigationSplitViewColumnWidth(min: 320, ideal: 420)
        }
        .frame(minWidth: 900, minHeight: 560)
        // `CollectionModel`/`EnvironmentModel` set `lastError` on every failed
        // disk op (including a failed Save) but never clear it on their own —
        // without this, nothing ever surfaced the failure to the user.
        .alert(
            "Collection Error",
            isPresented: collectionErrorPresented,
            actions: {},
            message: { Text(model.collection.lastError ?? "") },
        )
        .alert(
            "Environment Error",
            isPresented: environmentErrorPresented,
            actions: {},
            message: { Text(model.environment.lastError ?? "") },
        )
    }

    private var collectionErrorPresented: Binding<Bool> {
        Binding(
            get: { model.collection.lastError != nil },
            set: { isPresented in if !isPresented { model.collection.lastError = nil } },
        )
    }

    private var environmentErrorPresented: Binding<Bool> {
        Binding(
            get: { model.environment.lastError != nil },
            set: { isPresented in if !isPresented { model.environment.lastError = nil } },
        )
    }
}
