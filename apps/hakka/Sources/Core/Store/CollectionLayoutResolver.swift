import Foundation
import HakkaCommon

/// Where every node in a `Collection` value lives on disk, computed purely
/// from that value (no filesystem access). Folder slugs and request slugs
/// are deduped in separate namespaces per directory level, because a folder
/// becomes a directory and a request becomes a `directory/slug.hakka` file —
/// same name, different filesystem entries, so they cannot actually collide.
struct ResolvedCollectionLayout {
    var requestFiles: [String: URL] = [:]
    var requestSeq: [String: Int] = [:]
    var folderDirectories: [String: URL] = [:]
    var folderMetadataFiles: [String: URL] = [:]
    var folderSeq: [String: Int] = [:]
}

enum CollectionLayoutResolver {
    /// Container-metadata basenames ("collection", "folder") derived from
    /// `CollectionFileFormat`, reserved in every directory's request-slug
    /// namespace before any request is assigned a slug. Without this, a
    /// request named "Collection" (root level) or "Folder" (any folder
    /// level) would slugify to the exact same `<dir>/<slug>.hakka` path as
    /// that directory's own `collection.hakka`/`folder.hakka`, silently
    /// overwriting the container's metadata and bricking the whole
    /// collection on the next load. Reserving both names unconditionally at
    /// every level (root and folder alike) is a harmless over-reservation —
    /// it costs nothing to also reserve "folder" at the root — and needs no
    /// root-vs-folder branching.
    private static let reservedContainerSlugs = Set(
        [CollectionFileFormat.collectionMetadataFilename, CollectionFileFormat.folderMetadataFilename]
            .map { URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent },
    )

    static func resolve(_ collection: Collection, root: URL) -> ResolvedCollectionLayout {
        var layout = ResolvedCollectionLayout()
        walk(collection.nodes, directory: root, into: &layout)
        return layout
    }

    private static func walk(
        _ nodes: [CollectionNode],
        directory: URL,
        into layout: inout ResolvedCollectionLayout,
    ) {
        var usedRequestSlugs = reservedContainerSlugs
        var usedFolderSlugs = Set<String>()
        for (index, node) in nodes.enumerated() {
            switch node {
            case let .request(spec):
                let slug = CollectionFileNaming.uniqueSlug(for: spec.name, used: &usedRequestSlugs)
                let url = directory.appendingPathComponent("\(slug).\(CollectionFileFormat.requestExtension)")
                layout.requestFiles[spec.id] = url
                layout.requestSeq[spec.id] = index

            case let .folder(folder):
                let slug = CollectionFileNaming.uniqueSlug(for: folder.name, used: &usedFolderSlugs)
                let dir = directory.appendingPathComponent(slug, isDirectory: true)
                layout.folderDirectories[folder.id] = dir
                layout.folderMetadataFiles[folder.id] =
                    dir.appendingPathComponent(CollectionFileFormat.folderMetadataFilename)
                layout.folderSeq[folder.id] = index
                walk(folder.children, directory: dir, into: &layout)
            }
        }
    }
}

extension URL {
    /// Comparison key for filesystem entries: `contentsOfDirectory` and a
    /// hand-built `appendingPathComponent` URL can differ in trailing slash
    /// or internal representation even when they name the same path.
    var standardizedPath: String {
        standardizedFileURL.path
    }
}
