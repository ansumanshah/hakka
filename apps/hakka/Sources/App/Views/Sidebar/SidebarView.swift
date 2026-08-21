import SwiftUI

/// Collection tree, the Traffic pseudo-section, and the environment picker —
/// the sidebar's three jobs per the app spec.
struct SidebarView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List(selection: selectionBinding) {
            Section("Collection") {
                OutlineGroup(model.collection.collection.nodes, id: \.id, children: \.childrenForOutline) { node in
                    CollectionNodeRow(node: node)
                }
            }
            Section("Traffic") {
                Label("Live Traffic", systemImage: "antenna.radiowaves.left.and.right")
                    .badge(model.traffic.requests.count)
                    .tag(SidebarSelection.traffic)
                Label("Rules", systemImage: "slider.horizontal.3")
                    .tag(SidebarSelection.rules)
            }
            Section("Environment") {
                EnvironmentPickerView()
            }
        }
        .listStyle(.sidebar)
        .navigationTitle(model.collection.collection.name)
        .toolbar {
            ToolbarItem {
                Button(action: model.newRequest) {
                    Label("New Request", systemImage: "plus.circle")
                }
                .help("New Request (⌘N)")
            }
            ToolbarItem {
                Button { model.collection.newFolder() } label: {
                    Label("New Folder", systemImage: "folder.badge.plus")
                }
                .help("New Folder")
            }
            if !model.markedForDeletion.isEmpty {
                ToolbarItem {
                    Button(role: .destructive) { model.deleteMarkedNodes() } label: {
                        Label("Delete \(model.markedForDeletion.count) Marked", systemImage: "trash")
                    }
                    .help("Delete every item marked for deletion")
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            openCollectionButton
        }
    }

    private var openCollectionButton: some View {
        Button {
            Task { await model.openCollectionDirectory() }
        } label: {
            Label(model.collection.directoryURL?.lastPathComponent ?? "Open Collection…", systemImage: "folder")
                .font(.caption)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .padding(8)
        .background(.bar)
    }

    private var selectionBinding: Binding<SidebarSelection?> {
        Binding(get: { model.selection }, set: { model.select($0) })
    }
}
