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

            SidebarRequestsSection()
            SidebarCaptureSection()
            SidebarProjectSection()
            SidebarDiagnosticsSection()
            SidebarDevicesSection()
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(ThemeTokens.Palette.surface)
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
}

/// Keeps collection-tree observation out of the sidebar shell so live capture,
/// logs, and storage updates do not rebuild every request row.
private struct SidebarRequestsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section("Requests") {
            Label("All Requests", systemImage: "square.stack.3d.up")
                .tag(SidebarSelection.requests)
            OutlineGroup(model.collection.collection.nodes, id: \.id, children: \.childrenForOutline) { node in
                CollectionNodeRow(node: node)
            }
        }
    }
}

/// Capture counts change for every incoming request. Isolating them here keeps
/// that hot stream from invalidating the collection and project sections.
private struct SidebarCaptureSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
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
    }
}

private struct SidebarProjectSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section("Project") {
            Label("Changes", systemImage: "point.3.connected.trianglepath.dotted")
                .tag(SidebarSelection.changes)
            Label("Storage", systemImage: "externaldrive")
                .badge(model.storage.stores.count)
                .tag(SidebarSelection.storage)
        }
    }
}

private struct SidebarDiagnosticsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section("Diagnostics") {
            Label("Logs", systemImage: "text.alignleft")
                .badge(model.logs.entries.count)
                .tag(SidebarSelection.logs)
        }
    }
}

private struct SidebarDevicesSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let summaries = model.traffic.deviceSummaries
        let scopedSearch = model.traffic.searchText.trimmingCharacters(in: .whitespaces)

        if !summaries.isEmpty {
            Section("Devices") {
                ForEach(summaries) { summary in
                    DeviceRowView(
                        summary: summary,
                        isScoped: summary.device.label.map { scopedSearch == "device:\($0)" } ?? false
                    ) {
                        model.traffic.selectDevice(summary.device)
                        model.select(.traffic)
                    }
                }
            }
        }
    }
}
