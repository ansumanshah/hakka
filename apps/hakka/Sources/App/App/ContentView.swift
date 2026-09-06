import SwiftUI

/// Root three-pane layout: collection/traffic sidebar, request editor or
/// live traffic in the center, response/inspection detail on the right —
/// SwiftUI's `NavigationSplitView` is the modern equivalent of a manual
/// `NSSplitView` and gets resizable, collapsible columns for free.
struct ContentView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(InspectorPlacement.placementKey) private var inspectorPlacementRaw = InspectorPlacement.trailing.rawValue
    @AppStorage(InspectorPlacement.visibilityKey) private var isInspectorVisible = true

    var body: some View {
        workspace
        .frame(minWidth: 960, minHeight: 560)  // ui-token-check-ignore: window chrome
        // Mounted once here, above the split view, so it is visible from
        // every pane — see `PauseInboxBanner`'s own doc comment for why that
        // matters more than it would for an ordinary status strip.
        .safeAreaInset(edge: .top) {
            PauseInboxBanner()
        }
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
        .alert(
            "Compare Sessions",
            isPresented: sessionCompareErrorPresented,
            actions: {},
            message: { Text(model.sessionCompare.lastError ?? "") },
        )
        .sheet(isPresented: sessionComparePresented) {
            if let diff = model.sessionCompare.diff {
                SessionCompareView(
                    diff: diff,
                    beforeName: model.sessionCompare.beforeName ?? "Before",
                    afterName: model.sessionCompare.afterName ?? "After",
                    dismiss: { model.sessionCompare.dismiss() },
                )
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    isInspectorVisible.toggle()
                } label: {
                    Label(isInspectorVisible ? "Hide Inspector" : "Show Inspector", systemImage: "sidebar.trailing")
                }
                .help(isInspectorVisible ? "Hide Inspector" : "Show Inspector")

                Menu {
                    Button("Inspector on Right") {
                        inspectorPlacementRaw = InspectorPlacement.trailing.rawValue
                        isInspectorVisible = true
                    }
                    .disabled(inspectorPlacement == .trailing && isInspectorVisible)
                    Button("Inspector on Bottom") {
                        inspectorPlacementRaw = InspectorPlacement.bottom.rawValue
                        isInspectorVisible = true
                    }
                    .disabled(inspectorPlacement == .bottom && isInspectorVisible)
                } label: {
                    Label("Inspector Position", systemImage: "rectangle.split.3x1")
                }
                .help("Place Inspector on Right or Bottom")
            }
        }
    }

    @ViewBuilder
    private var workspace: some View {
        if isInspectorVisible, inspectorPlacement == .bottom {
            NavigationSplitView {
                sidebar
            } detail: {
                VSplitView {
                    CenterPaneView()
                        .frame(minHeight: 250) // ui-token-check-ignore: split pane minimum
                    DetailPaneView()
                        .frame(minHeight: 220) // ui-token-check-ignore: split pane minimum
                }
            }
        } else if isInspectorVisible {
            NavigationSplitView {
                sidebar
            } content: {
                CenterPaneView()
                    .navigationSplitViewColumnWidth(min: 360, ideal: 520)
            } detail: {
                DetailPaneView()
                    .navigationSplitViewColumnWidth(min: 320, ideal: 440)
            }
        } else {
            NavigationSplitView {
                sidebar
            } detail: {
                CenterPaneView()
            }
        }
    }

    private var sidebar: some View {
        SidebarView()
            .navigationSplitViewColumnWidth(min: 200, ideal: 250, max: 380)
    }

    private var inspectorPlacement: InspectorPlacement {
        InspectorPlacement.value(from: inspectorPlacementRaw)
    }

    private var sessionComparePresented: Binding<Bool> {
        Binding(
            get: { model.sessionCompare.diff != nil },
            set: { isPresented in if !isPresented { model.sessionCompare.dismiss() } },
        )
    }

    private var sessionCompareErrorPresented: Binding<Bool> {
        Binding(
            get: { model.sessionCompare.lastError != nil },
            set: { isPresented in if !isPresented { model.sessionCompare.clearError() } },
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
