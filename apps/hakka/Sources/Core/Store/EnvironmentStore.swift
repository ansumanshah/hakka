import Foundation

/// Persists `RequestEnvironment` values — including secret variable values —
/// to a directory that is always a *sibling* of a collection directory, never
/// a descendant of it. This is the entire secrets story: `CollectionStore`
/// only ever serializes `Collection`/`Folder`/`RequestSpec`, none of which
/// hold a resolved variable value, so a secret can only reach disk through
/// this store, and this store never writes under a collection's own tree.
public actor EnvironmentStore {
    public init() {}

    public func load(forCollectionAt collectionDirectory: URL) throws -> [RequestEnvironment] {
        let dir = Self.environmentsDirectory(forCollectionAt: collectionDirectory)
        let fm = FileManager.default
        guard fm.fileExists(atPath: dir.path) else { return [] }
        let entries = try fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == CollectionFileFormat.requestExtension }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        return try entries.map { url in
            let data = try Data(contentsOf: url)
            return try CollectionFileFormat.decode(RequestEnvironment.self, from: data)
        }
    }

    /// Full reconciliation, mirroring `CollectionStore.save`: writes one file
    /// per environment, then removes any environment file this call didn't
    /// write (handles deletion and rename-as-move).
    public func save(_ environments: [RequestEnvironment], forCollectionAt collectionDirectory: URL) throws {
        let dir = Self.environmentsDirectory(forCollectionAt: collectionDirectory)
        let fm = FileManager.default
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)

        var used = Set<String>()
        var keptPaths = Set<String>()
        for environment in environments {
            let slug = CollectionFileNaming.uniqueSlug(for: environment.name, used: &used)
            let url = dir.appendingPathComponent("\(slug).\(CollectionFileFormat.requestExtension)")
            let data = try CollectionFileFormat.encode(environment)
            try data.write(to: url, options: .atomic)
            keptPaths.insert(url.standardizedPath)
        }

        let existing = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        for entry in existing where entry.pathExtension == CollectionFileFormat.requestExtension {
            if !keptPaths.contains(entry.standardizedPath) {
                try fm.removeItem(at: entry)
            }
        }
    }

    /// `<parent>/environments/<collection-directory-name>/`.
    ///
    /// The trailing component is load-bearing, not decoration. Without it every
    /// collection under one parent — `~/APIProjects/billing`, `~/APIProjects/auth`,
    /// the ordinary way to keep several projects — resolved to the *same*
    /// directory. Since `save` reconciles (it deletes any file it didn't just
    /// write), saving one collection's environments overwrote same-named
    /// environments belonging to a sibling and deleted the rest outright: one
    /// collection's "Prod" secret silently replaced another's.
    ///
    /// The directory's own name is used verbatim rather than slugified. It is
    /// already a legal path component — it came from the filesystem — and two
    /// sibling directories cannot share a name, so this is collision-free in a
    /// way a lossy slug would not be (`My API` and `my-api` slugify alike).
    public static func environmentsDirectory(forCollectionAt collectionDirectory: URL) -> URL {
        collectionDirectory
            .deletingLastPathComponent()
            .appendingPathComponent(CollectionFileFormat.environmentsDirectoryName, isDirectory: true)
            .appendingPathComponent(collectionDirectory.lastPathComponent, isDirectory: true)
    }
}
