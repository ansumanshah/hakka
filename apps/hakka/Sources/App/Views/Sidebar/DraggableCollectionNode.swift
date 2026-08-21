import CoreTransferable
import UniformTypeIdentifiers

/// What a sidebar row drags — just the id, resolved back through the live
/// tree at drop time (via `AppModel.moveNode`) so a drag started before an
/// intervening edit can't carry stale content across the drop.
struct DraggableCollectionNode: Codable, Transferable {
    let id: String

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .hakkaCollectionNode)
    }
}

extension UTType {
    /// In-process only — nothing outside Hakka needs to read this type, so
    /// it isn't declared in Info.plist; `UTType(exportedAs:)` registers it
    /// dynamically at runtime, which is all `.draggable`/`.dropDestination`
    /// need for a drag that starts and ends inside this app.
    static let hakkaCollectionNode = UTType(exportedAs: "app.hakka.collection-node")
}
