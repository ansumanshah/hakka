import HakkaCore
import SwiftUI

/// One sidebar row for either a folder or a request. Only request rows carry
/// a `.tag`, so `List(selection:)` treats folders as expand/collapse-only —
/// there is no request-less detail to show for a folder.
struct CollectionNodeRow: View {
    @Environment(AppModel.self) private var model
    let node: CollectionNode

    var body: some View {
        switch node {
        case let .folder(folder):
            HStack(spacing: Spacing.sm) {
                if model.markedForDeletion.contains(folder.id) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.tint)
                }
                Label(folder.name, systemImage: "folder")
                Spacer()
                if model.folderRun.isRunning, model.folderRun.runningFolderID == folder.id {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Button {
                        Task { await model.runFolder(folder) }
                    } label: {
                        Image(systemName: "play.circle")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .help("Run Folder")
                }
            }
            .rowDragDrop(node: node)
            .contextMenu { menuItems }
        case let .request(spec):
            HStack(spacing: Spacing.sm) {
                if model.markedForDeletion.contains(spec.id) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.tint)
                }
                Text(spec.method.rawValue)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Fmt.methodColor(spec.method))
                    .frame(width: 40, alignment: .leading)
                Text(spec.name)
                    .lineLimit(1)
            }
            .tag(SidebarSelection.request(id: spec.id))
            .rowDragDrop(node: node)
            .contextMenu { menuItems }
        }
    }

    @ViewBuilder
    private var menuItems: some View {
        if case let .folder(folder) = node {
            Button("Run") { Task { await model.runFolder(folder) } }
            Divider()
        }
        Button("Duplicate") { model.duplicateNode(id: node.id) }
        if model.collection.folderChain(for: node.id).isEmpty == false {
            Button("Move to Root") { model.moveNodeToRoot(id: node.id) }
        }
        Divider()
        let marked = model.markedForDeletion.contains(node.id)
        Button(marked ? "Unmark for Deletion" : "Mark for Deletion") {
            model.toggleMarkedForDeletion(id: node.id)
        }
        Button("Delete", role: .destructive) { model.deleteNode(id: node.id) }
    }
}

private extension View {
    /// Every row is both a drag source and a drop target: dragging is how a
    /// move or reorder starts, and accepting a drop is how it lands — see
    /// `AppModel.moveNode`.
    func rowDragDrop(node: CollectionNode) -> some View {
        modifier(RowDragDropModifier(node: node))
    }
}

private struct RowDragDropModifier: ViewModifier {
    @Environment(AppModel.self) private var model
    let node: CollectionNode

    func body(content: Content) -> some View {
        content
            .draggable(DraggableCollectionNode(id: node.id))
            .dropDestination(for: DraggableCollectionNode.self) { items, _ in
                guard let dragged = items.first else { return false }
                model.moveNode(dragged.id, onto: node)
                return true
            }
    }
}
