import SwiftUI

/// Project navigation ordered around Hakka's two primary workflows: authoring
/// collection requests and capturing traffic. Diagnostics and environment
/// controls remain available without competing with those primary sections.
struct SidebarView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List(selection: selectionBinding) {
            WorkspaceSidebarHeader()
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)

            Section("Requests") {
                Label("All Requests", systemImage: "square.stack.3d.up")
                    .tag(SidebarSelection.requests)
                OutlineGroup(model.collection.collection.nodes, id: \.id, children: \.childrenForOutline) { node in
                    CollectionNodeRow(node: node)
                }
            }

            Section("Capture") {
                Label("Live Traffic", systemImage: "antenna.radiowaves.left.and.right")
                    .badge(model.traffic.requests.count)
                    .tag(SidebarSelection.traffic)
                Label("Rules", systemImage: "slider.horizontal.3")
                    .badge(model.rules.entries.filter(\.isEnabled).count)
                    .tag(SidebarSelection.rules)
                Label("Runs", systemImage: "checklist")
                    .tag(SidebarSelection.runs)
                Label("Proxy", systemImage: "network")
                    .tag(SidebarSelection.proxy)
            }

            Section("Project") {
                Label("Changes", systemImage: "point.3.connected.trianglepath.dotted")
                    .tag(SidebarSelection.changes)
                Label("Storage", systemImage: "externaldrive")
                    .badge(model.storage.stores.count)
                    .tag(SidebarSelection.storage)
            }

            Section("Diagnostics") {
                Label("Logs", systemImage: "text.alignleft")
                    .badge(model.logs.entries.count)
                    .tag(SidebarSelection.logs)
            }


            if !model.traffic.deviceSummaries.isEmpty {
                Section("Devices") {
                    devicesSectionContent
                }
            }

        }
        .listStyle(.sidebar)
        .navigationTitle("Workspace")
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
    }

    private var selectionBinding: Binding<SidebarSelection?> {
        Binding(get: { model.selection }, set: { model.select($0) })
    }

    /// Not `List` selection rows — see `DeviceRowView`'s doc comment for why.
    /// The containing section only appears for connected devices, keeping the
    /// source list focused.
    @ViewBuilder
    private var devicesSectionContent: some View {
        ForEach(model.traffic.deviceSummaries) { summary in
            DeviceRowView(summary: summary, isScoped: isScoped(summary.device)) {
                model.traffic.selectDevice(summary.device)
                model.select(.traffic)
            }
        }
    }

    /// Whether the traffic list is currently scoped to `device` — drives
    /// `DeviceRowView`'s highlight. Reads `traffic.searchText` directly
    /// rather than a stored flag, so it can never drift from the actual
    /// filter (e.g. if the user edits the search bar by hand).
    private func isScoped(_ device: ConnectedDevice) -> Bool {
        guard let label = device.label else { return false }
        return model.traffic.searchText.trimmingCharacters(in: .whitespaces) == "device:\(label)"
    }
}
