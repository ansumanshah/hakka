import Foundation

/// Persists `RequestEnvironment` values — including secret variable values —
/// to a directory that is always a *sibling* of a collection directory, never
/// a descendant of it. This is the entire secrets story: `CollectionStore`
/// only ever serializes `Collection`/`Folder`/`RequestSpec`, none of which
/// hold a resolved variable value, so a secret can only reach disk through
/// this store, and this store never writes under a collection's own tree.
///
/// A `secret == true` variable's *value* takes one further step: `save`
/// writes it to `SecretKeychainStore` and puts `SecretReference.token` — not
/// the value — in the `.hakka` file, so the on-disk JSON never holds a raw
/// secret even in the sibling directory. `load` resolves the token back
/// through the Keychain, so every other caller (`EnvironmentModel`,
/// `VariableScope`, the request runner) keeps seeing a plain, already-usable
/// `String` and needs no awareness that the value came from two places.
public actor EnvironmentStore {
    private let keychain: SecretKeychainStore

    public init(keychain: SecretKeychainStore = SecretKeychainStore()) {
        self.keychain = keychain
    }

    /// A file written before this build's Keychain integration has a raw
    /// secret value in place of a token — `SecretReference.isReference`
    /// is false for it, so it round-trips as-is, unresolved and untouched,
    /// exactly like a non-secret variable. It only migrates into the
    /// Keychain the next time this environment is saved (`save` always
    /// writes every current secret value to the Keychain and a token to
    /// disk, whatever `load` handed back), which is deliberate: `load`
    /// stays read-only, and a user who never touches Settings again after
    /// upgrading is not surprised by a background write to their Keychain.
    public func load(forCollectionAt collectionDirectory: URL) async throws -> [RequestEnvironment] {
        let dir = Self.environmentsDirectory(forCollectionAt: collectionDirectory)
        let fm = FileManager.default
        guard fm.fileExists(atPath: dir.path) else { return [] }
        let entries = try fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == CollectionFileFormat.requestExtension }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        var result: [RequestEnvironment] = []
        for url in entries {
            let data = try Data(contentsOf: url)
            var environment = try CollectionFileFormat.decode(RequestEnvironment.self, from: data)
            for index in environment.variables.indices {
                let variable = environment.variables[index]
                guard variable.secret, SecretReference.isReference(variable.value) else { continue }
                // A reference token with no matching Keychain item is a
                // broken secret, not an absent one — resolving it to ""
                // would let a request go out with a blank credential where
                // the user would never notice a 401 was really "the
                // Keychain lost this value". Throwing surfaces it instead,
                // same as `EnvironmentModel.load` already does for any
                // other load failure.
                environment.variables[index].value = try await keychain.read(
                    collection: collectionDirectory,
                    environmentID: environment.id,
                    variableID: variable.id,
                )
            }
            result.append(environment)
        }
        return result
    }

    /// Full reconciliation, mirroring `CollectionStore.save`: writes one file
    /// per environment, then removes any environment file this call didn't
    /// write (handles deletion and rename-as-move) — and, for secrets,
    /// deletes any Keychain item this call's variables no longer account
    /// for, so a deleted variable or a deleted environment never leaves an
    /// orphaned item behind.
    public func save(_ environments: [RequestEnvironment], forCollectionAt collectionDirectory: URL) async throws {
        let dir = Self.environmentsDirectory(forCollectionAt: collectionDirectory)
        let fm = FileManager.default
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)

        // Snapshot of secret identities as they stand on disk *before* this
        // call's writes — the baseline `currentSecretIdentities` below is
        // diffed against to find what this save orphans. A raw scan (not
        // `load`) on purpose: it only needs `secret`/`id`, never the actual
        // value, so a pre-existing broken Keychain item can't fail a save
        // that doesn't even touch it.
        let previousSecretIdentities = Self.secretIdentities(scanning: dir)

        var used = Set<String>()
        var keptPaths = Set<String>()
        var currentSecretIdentities: Set<SecretIdentity> = []

        for environment in environments {
            var toWrite = environment
            for index in toWrite.variables.indices where toWrite.variables[index].secret {
                let variable = toWrite.variables[index]
                currentSecretIdentities.insert(SecretIdentity(environmentID: environment.id, variableID: variable.id))
                try await keychain.save(
                    variable.value,
                    collection: collectionDirectory,
                    environmentID: environment.id,
                    variableID: variable.id,
                )
                toWrite.variables[index].value = SecretReference.token
            }

            let slug = CollectionFileNaming.uniqueSlug(for: toWrite.name, used: &used)
            let url = dir.appendingPathComponent("\(slug).\(CollectionFileFormat.requestExtension)")
            let data = try CollectionFileFormat.encode(toWrite)
            try data.write(to: url, options: .atomic)
            keptPaths.insert(url.standardizedPath)
        }

        let existing = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        for entry in existing where entry.pathExtension == CollectionFileFormat.requestExtension {
            if !keptPaths.contains(entry.standardizedPath) {
                try fm.removeItem(at: entry)
            }
        }

        for orphan in previousSecretIdentities.subtracting(currentSecretIdentities) {
            try await keychain.delete(
                collection: collectionDirectory,
                environmentID: orphan.environmentID,
                variableID: orphan.variableID,
            )
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

    // MARK: - Secret reconciliation

    /// One secret variable's identity within `dir`, stable across a rename of
    /// either half (an environment's `id` and a variable's `id` never change)
    /// — what `save` diffs before/after to find which Keychain items a call
    /// orphans.
    private struct SecretIdentity: Hashable {
        let environmentID: String
        let variableID: String
    }

    /// Every currently-secret `(environment, variable)` id pair found in
    /// `dir`'s `.hakka` files, decoding only enough to read `secret`/`id` —
    /// deliberately not `load(forCollectionAt:)`, which also resolves
    /// Keychain values and would fail this scan over one broken item
    /// unrelated to whatever `save` is actually reconciling. An unreadable
    /// or undecodable file is skipped rather than thrown: `save` must still
    /// be able to reconcile every *other* environment in the directory.
    private static func secretIdentities(scanning dir: URL) -> Set<SecretIdentity> {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return [] }
        var result: Set<SecretIdentity> = []
        for url in entries where url.pathExtension == CollectionFileFormat.requestExtension {
            guard let data = try? Data(contentsOf: url),
                  let environment = try? CollectionFileFormat.decode(RequestEnvironment.self, from: data)
            else { continue }
            for variable in environment.variables where variable.secret {
                result.insert(SecretIdentity(environmentID: environment.id, variableID: variable.id))
            }
        }
        return result
    }
}

/// The placeholder `EnvironmentStore.save` writes to a `.hakka` file in
/// place of a secret variable's real value. Carries no data of its own — the
/// (collection, environment id, variable id) already in scope at both call
/// sites is what `SecretKeychainStore` keys on — so this only needs to be
/// unambiguously recognizable as "resolve me", never a value a person would
/// plausibly type into a variable themselves.
enum SecretReference {
    static let token = "hakka-keychain-secret:v1"

    static func isReference(_ value: String) -> Bool {
        value == token
    }
}
