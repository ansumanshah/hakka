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
            Label(folder.name, systemImage: "folder")
                .contextMenu {
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
