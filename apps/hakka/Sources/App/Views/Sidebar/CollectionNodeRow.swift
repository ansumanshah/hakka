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
            HStack(spacing: 6) {
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
            .contextMenu {
                Button("Run") { Task { await model.runFolder(folder) } }
                Divider()
                Button("Delete", role: .destructive) { model.deleteNode(id: folder.id) }
            }
        case let .request(spec):
            HStack(spacing: 6) {
                Text(spec.method.rawValue)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Fmt.methodColor(spec.method))
                    .frame(width: 40, alignment: .leading)
                Text(spec.name)
                    .lineLimit(1)
            }
            .tag(SidebarSelection.request(id: spec.id))
            .contextMenu {
                Button("Delete", role: .destructive) { model.deleteNode(id: spec.id) }
            }
        }
    }
}
