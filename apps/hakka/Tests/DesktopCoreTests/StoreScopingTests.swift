import Foundation
import Testing

@testable import HakkaDesktopCore

/// Two defects that only show up once a user keeps more than one collection,
/// or names a request the way people actually name things.
///
/// Both were found by auditing ADR 0008's "built" claims rather than by a
/// crash, and both are silent: the app reports success and the data is gone.
@Suite("store scoping")
struct StoreScopingTests {
    private func tempDir() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hakka-scoping-\(UUID().uuidString)")
    }

    // MARK: - Environments are scoped to their own collection

    /// The ordinary layout: several collections side by side under one folder.
    /// Environments used to resolve to `<parent>/environments` for all of them,
    /// so the second collection's save overwrote the first's same-named
    /// environment and deleted every other one, because `save` reconciles.
    @Test("sibling collections do not share an environments directory")
    func siblingCollectionsAreIsolated() async throws {
        let parent = tempDir()
        defer { try? FileManager.default.removeItem(at: parent) }
        let billing = parent.appendingPathComponent("billing")
        let auth = parent.appendingPathComponent("auth")
        let store = EnvironmentStore()

        try await store.save(
            [
                RequestEnvironment(name: "Prod", variables: [EnvironmentVariable(name: "apiKey", value: "billing-secret", secret: true)]),
                RequestEnvironment(name: "Dev", variables: [EnvironmentVariable(name: "apiKey", value: "billing-dev")]),
            ],
            forCollectionAt: billing,
        )

        try await store.save(
            [RequestEnvironment(name: "Prod", variables: [EnvironmentVariable(name: "apiKey", value: "auth-secret", secret: true)])],
            forCollectionAt: auth,
        )

        let billingEnvs = try await store.load(forCollectionAt: billing)
        #expect(billingEnvs.map(\.name).sorted() == ["Dev", "Prod"])
        #expect(billingEnvs.first(where: { $0.name == "Prod" })?.variables.first?.value == "billing-secret")

        let authEnvs = try await store.load(forCollectionAt: auth)
        #expect(authEnvs.map(\.name) == ["Prod"])
        #expect(authEnvs.first?.variables.first?.value == "auth-secret")
    }

    @Test("each collection gets its own environments subdirectory")
    func environmentsDirectoryIsPerCollection() {
        let parent = URL(fileURLWithPath: "/tmp/projects")
        let a = EnvironmentStore.environmentsDirectory(forCollectionAt: parent.appendingPathComponent("billing"))
        let b = EnvironmentStore.environmentsDirectory(forCollectionAt: parent.appendingPathComponent("auth"))

        #expect(a != b)
        #expect(a.lastPathComponent == "billing")
        #expect(b.lastPathComponent == "auth")
    }

    /// The point of keeping secrets out of the collection tree is that the
    /// collection directory can be committed; nesting per collection must not
    /// quietly undo that.
    @Test("environments still live outside the collection directory")
    func environmentsStayOutsideTheCollection() {
        let collection = URL(fileURLWithPath: "/tmp/projects/billing")
        let dir = EnvironmentStore.environmentsDirectory(forCollectionAt: collection)

        #expect(!dir.standardizedPath.hasPrefix(collection.standardizedPath + "/"))
    }

    /// Same collection name, different parents — these are different projects
    /// and must not share secrets either.
    @Test("same-named collections under different parents stay separate")
    func sameNameDifferentParents() async throws {
        let root = tempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let first = root.appendingPathComponent("work").appendingPathComponent("api")
        let second = root.appendingPathComponent("personal").appendingPathComponent("api")
        let store = EnvironmentStore()

        try await store.save([RequestEnvironment(name: "Prod", variables: [EnvironmentVariable(name: "k", value: "work")])], forCollectionAt: first)
        try await store.save([RequestEnvironment(name: "Prod", variables: [EnvironmentVariable(name: "k", value: "personal")])], forCollectionAt: second)

        let firstEnvs = try await store.load(forCollectionAt: first)
        #expect(firstEnvs.first?.variables.first?.value == "work")
    }

    // MARK: - Long names do not abort the save

    /// A 300-character name produced a filename past the 255-byte limit. The
    /// write threw, so every node after it in iteration order was never
    /// written and the stale-entry prune never ran — a partial save reported
    /// as an error with no indication of what landed.
    @Test("a very long request name saves, and does not strand its siblings")
    func longNameDoesNotAbortTheSave() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let longName = String(repeating: "extremely descriptive request name ", count: 10)
        let collection = Collection(
            name: "API",
            nodes: [
                .request(RequestSpec(name: longName, url: "https://example.com/long")),
                .request(RequestSpec(name: "After", url: "https://example.com/after")),
            ],
        )

        try await store.save(collection, to: dir)
        let reloaded = try await store.load(directory: dir)

        #expect(reloaded.nodes.count == 2)
        #expect(reloaded.nodes.contains { $0.name == "After" })
        #expect(reloaded.nodes.contains { $0.name == longName })
    }

    @Test("slugs are capped below the filesystem's name limit")
    func slugIsCapped() {
        let slug = CollectionFileNaming.slug(for: String(repeating: "a", count: 500))

        #expect(slug.count <= CollectionFileNaming.maxSlugLength)
        #expect(!slug.hasSuffix("-"))
    }

    /// Truncation must not turn two distinct long names into one file.
    @Test("two long names that share a prefix still get distinct files")
    func longNamesStillDisambiguate() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let prefix = String(repeating: "shared prefix ", count: 30)
        let collection = Collection(
            name: "API",
            nodes: [
                .request(RequestSpec(name: prefix + "one", url: "https://example.com/1")),
                .request(RequestSpec(name: prefix + "two", url: "https://example.com/2")),
            ],
        )

        try await store.save(collection, to: dir)
        let reloaded = try await store.load(directory: dir)

        #expect(reloaded.nodes.count == 2)
        #expect(Set(reloaded.nodes.map(\.name)).count == 2)
    }
}
