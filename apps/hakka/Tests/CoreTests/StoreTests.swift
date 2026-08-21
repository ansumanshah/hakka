import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

@Suite("CollectionStore")
struct CollectionStoreTests {
    private func tempDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("hakka-store-tests-\(UUID().uuidString)", isDirectory: true)
    }

    /// Exercises every `BodySpec`/`AuthSpec` case, assertions, captures, and
    /// a nested folder — the full surface `load(save(x)) == x` must survive.
    private func kitchenSinkCollection() -> Collection {
        let auths: [AuthSpec] = [
            .inherit,
            .none,
            .basic(username: "user", password: "pass"),
            .bearer(token: "tok"),
            .apiKey(name: "X-Key", value: "v", placement: .header),
            .apiKey(name: "key", value: "v", placement: .query),
            .oauth2(accessToken: "at"),
            .oauth2(OAuth2Config(
                grant: .clientCredentials(ClientCredentialsGrant(tokenURL: "https://x/token", clientId: "cid", clientSecret: "secret", scope: "read")),
                accessTokenVariable: "cc_token",
            )),
            .oauth2(OAuth2Config(
                grant: .authorizationCode(AuthorizationCodeGrant(authorizationURL: "https://x/authorize", tokenURL: "https://x/token", clientId: "cid", clientSecret: "s", scope: "read write", redirectPort: 51234)),
                refreshTokenVariable: "auth_refresh",
                expiresAtVariable: nil,
            )),
        ]
        let bodies: [BodySpec] = [
            .none,
            .raw(text: "{\"a\":1}", contentType: "application/json"),
            .form([HeaderPair(name: "f", value: "1")]),
            .multipart([MultipartPart(name: "file", filePath: "/tmp/x", contentType: "text/plain")]),
            .graphql(query: "query Me { me } query Other { other }", variables: "{}", operationName: "Me"),
            .file(path: "/tmp/upload.bin", contentType: "application/octet-stream"),
        ]

        // `auths` and `bodies` intentionally have different counts (there are
        // more `AuthSpec` cases worth exercising than `BodySpec` ones), so
        // pairing cycles the shorter list by index rather than truncating to
        // it — every auth case above gets exercised, not just the first six.
        let requests = auths.indices.map { index in
            RequestSpec(
                name: "Req \(index)",
                method: HttpMethod.allCases[index % HttpMethod.allCases.count],
                url: "https://api.example.com/\(index)",
                headers: [HeaderPair(name: "Accept", value: "application/json")],
                query: [HeaderPair(name: "q", value: "1")],
                body: bodies[index % bodies.count],
                auth: auths[index],
                assertions: [
                    Assertion(target: .status, op: .equals, expected: "200"),
                    Assertion(target: .jsonPath("data.id"), op: .exists, expected: ""),
                    Assertion(target: .header(name: "X-Trace"), op: .contains, expected: "abc"),
                ],
                captures: [ResponseCapture(variable: "token", source: .jsonPath("data.token"))],
                notes: "note \(index)",
                timeout: 30,
                followRedirects: index.isMultiple(of: 2),
                // Only the first request carries scripts, deliberately —
                // exercises both `scripts == nil` (every other request) and
                // a populated, multi-line `RequestScripts` in the same
                // round trip.
                scripts: index == 0
                    ? RequestScripts(
                        preRequestLines: ["request.headers['X-Signed'] = 'yes';", "log('signing');"],
                        postResponseLines: ["vars.set('lastStatus', String(response.status));"],
                    )
                    : nil,
            )
        }

        let nested = Folder(
            name: "Nested",
            children: [.request(requests[0])],
            headers: [HeaderPair(name: "X-Folder", value: "inner")],
        )
        let outer = Folder(
            name: "Auth",
            children: [.folder(nested), .request(requests[1])],
            auth: .bearer(token: "folder-token"),
        )

        return Collection(
            name: "Kitchen Sink",
            nodes: [.folder(outer)] + requests[2...].map { .request($0) },
            defaultHeaders: [HeaderPair(name: "User-Agent", value: "hakka")],
            auth: .basic(username: "root", password: "secret"),
            notes: "collection notes",
        )
    }

    @Test func roundTripPreservesEveryCase() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()
        let original = kitchenSinkCollection()

        try await store.save(original, to: dir)
        let loaded = try await store.load(directory: dir)

        #expect(loaded == original)
    }

    /// ADR 0010 phase 4.2 bumped `collectionFormatVersion` from 3 to 4 when
    /// `RequestSpec` grew `scripts`. A version-3 file has no `scripts` key
    /// at all — reproduced faithfully here, not hand-typed as raw JSON,
    /// because `RequestFile(seq:spec:)` with `spec.scripts == nil` encodes
    /// to exactly the bytes version-3 code would have written (the
    /// `Optional` stored property is `encodeIfPresent`-backed — see
    /// `RequestSpec.scripts`'s doc comment). Stamping `version: 3` on the
    /// metadata file is what actually exercises the old-format path,
    /// distinct from a fresh version-4 save that merely happens to have no
    /// scripts.
    @Test func versionThreeFileStillReadsAfterTheScriptsBump() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let metadata = CollectionMetadataFile(
            version: 3,
            id: UUID().uuidString,
            name: "Legacy",
            defaultHeaders: [],
            auth: .none,
            notes: nil,
        )
        try CollectionFileFormat.encode(metadata)
            .write(to: dir.appendingPathComponent(CollectionFileFormat.collectionMetadataFilename))

        let spec = RequestSpec(name: "Legacy Request", url: "https://api.example.com/legacy")
        try CollectionFileFormat.encode(RequestFile(seq: 1, spec: spec))
            .write(to: dir.appendingPathComponent("legacy-request.hakka"))

        let store = CollectionStore()
        let loaded = try await store.load(directory: dir)

        #expect(loaded.name == "Legacy")
        guard case let .request(loadedSpec) = loaded.nodes.first else {
            Issue.record("expected a top-level request")
            return
        }
        #expect(loadedSpec.name == "Legacy Request")
        #expect(loadedSpec.scripts == nil)
    }

    @Test func serializationIsByteIdenticalAcrossRuns() async throws {
        let dirA = tempDirectory()
        let dirB = tempDirectory()
        defer {
            try? FileManager.default.removeItem(at: dirA)
            try? FileManager.default.removeItem(at: dirB)
        }
        let collection = kitchenSinkCollection()
        let store = CollectionStore()
        try await store.save(collection, to: dirA)
        try await store.save(collection, to: dirB)

        let fileA = dirA.appendingPathComponent(CollectionFileFormat.collectionMetadataFilename)
        let fileB = dirB.appendingPathComponent(CollectionFileFormat.collectionMetadataFilename)
        #expect(try Data(contentsOf: fileA) == Data(contentsOf: fileB))

        let text = try String(contentsOf: fileA, encoding: .utf8)
        #expect(text.hasSuffix("\n"))
        #expect(!text.hasSuffix("\n\n"))
        #expect(text.contains("  \""))
    }

    @Test func saveRequestRewritesOnlyItsOwnFile() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()
        var collection = kitchenSinkCollection()
        try await store.save(collection, to: dir)

        guard case var .request(target) = collection.nodes.last else {
            Issue.record("expected a top-level request")
            return
        }
        let untouchedURL = dir.appendingPathComponent("collection.hakka")
        let untouchedBefore = try Data(contentsOf: untouchedURL)

        target.notes = "edited via saveRequest"
        collection.nodes[collection.nodes.count - 1] = .request(target)
        try await store.saveRequest(target, in: collection, to: dir)

        let untouchedAfter = try Data(contentsOf: untouchedURL)
        #expect(untouchedBefore == untouchedAfter)

        let loaded = try await store.load(directory: dir)
        #expect(loaded == collection)
    }

    @Test func renamingRequestMovesItsFileWithoutLeavingTheOldOneBehind() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()
        var collection = kitchenSinkCollection()
        try await store.save(collection, to: dir)

        guard case var .request(target) = collection.nodes.last else {
            Issue.record("expected a top-level request")
            return
        }
        let oldSlug = CollectionFileNaming.slug(for: target.name)
        let oldURL = dir.appendingPathComponent("\(oldSlug).hakka")
        #expect(FileManager.default.fileExists(atPath: oldURL.path))

        target.name = "Renamed Request"
        collection.nodes[collection.nodes.count - 1] = .request(target)
        try await store.saveRequest(target, in: collection, to: dir)

        #expect(!FileManager.default.fileExists(atPath: oldURL.path))
        let newURL = dir.appendingPathComponent("renamed-request.hakka")
        #expect(FileManager.default.fileExists(atPath: newURL.path))

        let loaded = try await store.load(directory: dir)
        #expect(loaded == collection)
    }

    @Test func deletingRequestRemovesItsFile() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()
        let collection = kitchenSinkCollection()
        try await store.save(collection, to: dir)

        guard case let .request(target) = collection.nodes.last else {
            Issue.record("expected a top-level request")
            return
        }
        try await store.deleteNode(id: target.id, in: collection, from: dir)

        let loaded = try await store.load(directory: dir)
        #expect(!loaded.nodes.contains { $0.id == target.id })
    }

    @Test func deletingFolderRemovesItsSubtree() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()
        let collection = kitchenSinkCollection()
        try await store.save(collection, to: dir)

        guard case let .folder(outer) = collection.nodes.first else {
            Issue.record("expected a top-level folder")
            return
        }
        try await store.deleteNode(id: outer.id, in: collection, from: dir)

        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("auth").path))
        let loaded = try await store.load(directory: dir)
        #expect(loaded.nodes.count == collection.nodes.count - 1)
    }

    @Test func namesAreSlugifiedCollisionSuffixedAndCannotEscapeTheDirectory() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let malicious = RequestSpec(name: "../../etc/passwd", url: "https://example.com")
        let duplicateA = RequestSpec(name: "Get User", url: "https://example.com/a")
        let duplicateB = RequestSpec(name: "Get User", url: "https://example.com/b")
        let collection = Collection(
            name: "Escaping",
            nodes: [.request(malicious), .request(duplicateA), .request(duplicateB)],
        )

        try await store.save(collection, to: dir)

        let entries = try FileManager.default.contentsOfDirectory(atPath: dir.path)
        #expect(entries.contains("etc-passwd.hakka"))
        #expect(entries.contains("get-user.hakka"))
        #expect(entries.contains("get-user-2.hakka"))

        let parent = dir.deletingLastPathComponent()
        let parentEntriesBefore = try FileManager.default.contentsOfDirectory(atPath: parent.path)
        #expect(!parentEntriesBefore.contains("passwd"))

        let loaded = try await store.load(directory: dir)
        #expect(Set(loaded.nodes.map(\.name)) == Set(collection.nodes.map(\.name)))
    }

    /// Regression for the container-metadata collision bug: a top-level
    /// request named "Collection" slugifies to `collection.hakka`, the exact
    /// filename `writeCollection` already used for the collection's own
    /// metadata. Before `CollectionLayoutResolver` reserved that basename,
    /// this silently clobbered `collection.hakka` and made the whole
    /// collection undecodable on the next `load`.
    @Test func requestNamedCollectionAtRootDoesNotOverwriteCollectionMetadata() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let request = RequestSpec(name: "Collection", url: "https://example.com")
        let collection = Collection(name: "Root Collision", nodes: [.request(request)])

        try await store.save(collection, to: dir)

        let entries = try FileManager.default.contentsOfDirectory(atPath: dir.path)
        #expect(entries.contains("collection.hakka"))
        #expect(entries.contains("collection-2.hakka"))

        let loaded = try await store.load(directory: dir)
        #expect(loaded.name == "Root Collision")
        #expect(loaded.nodes.map(\.name) == ["Collection"])
    }

    /// Same root cause, folder level: a request named "Folder" directly
    /// inside a folder slugifies to `folder.hakka`, colliding with that
    /// folder's own metadata file in the same directory. Before the fix,
    /// `readFolder` threw an uncaught `DecodingError` decoding `FolderFile`
    /// from the overwritten `RequestFile` JSON, bricking the entire load.
    @Test func requestNamedFolderInsideAFolderDoesNotOverwriteFolderMetadata() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let request = RequestSpec(name: "Folder", url: "https://example.com")
        let folder = Folder(name: "Parent", children: [.request(request)])
        let collection = Collection(name: "Folder Collision", nodes: [.folder(folder)])

        try await store.save(collection, to: dir)

        let folderDir = dir.appendingPathComponent("parent")
        let entries = try FileManager.default.contentsOfDirectory(atPath: folderDir.path)
        #expect(entries.contains("folder.hakka"))
        #expect(entries.contains("folder-2.hakka"))

        let loaded = try await store.load(directory: dir)
        guard case let .folder(loadedFolder) = loaded.nodes.first else {
            Issue.record("expected a top-level folder")
            return
        }
        #expect(loadedFolder.name == "Parent")
        #expect(loadedFolder.children.map(\.name) == ["Folder"])
    }

    /// The single-file fast path (`saveRequest`) shares `CollectionLayoutResolver`
    /// with the full `save`, so renaming one request to "Folder" while its
    /// sibling folder metadata sits in the same directory must not corrupt
    /// that sibling either — reachable one edit at a time, without going
    /// through `save`'s full reconciliation.
    @Test func saveRequestRenamedToFolderDoesNotOverwriteSiblingFolderMetadata() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        var request = RequestSpec(name: "Original", url: "https://example.com")
        let folder = Folder(name: "Parent", children: [.request(request)])
        var collection = Collection(name: "Fast Path Collision", nodes: [.folder(folder)])
        try await store.save(collection, to: dir)

        guard case var .folder(updatedFolder) = collection.nodes[0] else {
            Issue.record("expected a top-level folder")
            return
        }
        request.name = "Folder"
        updatedFolder.children[0] = .request(request)
        collection.nodes[0] = .folder(updatedFolder)

        try await store.saveRequest(request, in: collection, to: dir)

        let folderDir = dir.appendingPathComponent("parent")
        let entries = try FileManager.default.contentsOfDirectory(atPath: folderDir.path)
        #expect(entries.contains("folder.hakka"))
        #expect(entries.contains("folder-2.hakka"))

        let loaded = try await store.load(directory: dir)
        #expect(loaded == collection)
    }
}

@Suite("EnvironmentStore")
struct EnvironmentStoreTests {
    /// The "environments" directory is a sibling of the collection directory,
    /// so `dir` must live under a directory unique to this test — otherwise
    /// two tests both directly under the shared system temp directory would
    /// resolve to the very same sibling `environments/` path and race.
    private func tempDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("hakka-env-tests-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("Collection", isDirectory: true)
    }

    @Test func roundTripsVariablesIncludingSecrets() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let environments = [
            RequestEnvironment(name: "Prod", variables: [
                EnvironmentVariable(name: "apiKey", value: "sk-super-secret-value", secret: true),
                EnvironmentVariable(name: "host", value: "api.example.com"),
            ]),
            RequestEnvironment(name: "Dev", variables: [
                EnvironmentVariable(name: "host", value: "localhost"),
            ]),
        ]
        let store = EnvironmentStore()

        try await store.save(environments, forCollectionAt: dir)
        let loaded = try await store.load(forCollectionAt: dir)

        // Environments are keyed by name on disk (one file per environment,
        // filename alphabetical), not by list position — compare by name.
        #expect(loaded.sorted { $0.name < $1.name } == environments.sorted { $0.name < $1.name })
    }

    @Test func livesOutsideTheCollectionDirectoryAsASibling() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        // Sibling `environments/`, then one subdirectory per collection — the
        // per-collection level keeps two collections under one parent from
        // overwriting each other's secrets (see StoreScopingTests).
        let expected = dir
            .deletingLastPathComponent()
            .appendingPathComponent("environments", isDirectory: true)
            .appendingPathComponent(dir.lastPathComponent, isDirectory: true)
        #expect(EnvironmentStore.environmentsDirectory(forCollectionAt: dir).standardizedFileURL == expected.standardizedFileURL)
    }

    @Test func secretValuesNeverAppearAnywhereUnderTheCollectionTree() async throws {
        let dir = tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let secretValue = "sk-super-secret-value-9f2c"

        let request = RequestSpec(
            name: "Whoami",
            url: "https://api.example.com/whoami",
            headers: [HeaderPair(name: "Authorization", value: "Bearer {{apiKey}}")],
        )
        let collection = Collection(name: "Secrets", nodes: [.request(request)])
        let environment = RequestEnvironment(
            name: "Prod",
            variables: [EnvironmentVariable(name: "apiKey", value: secretValue, secret: true)],
        )

        let collectionStore = CollectionStore()
        let environmentStore = EnvironmentStore()
        try await collectionStore.save(collection, to: dir)
        try await environmentStore.save([environment], forCollectionAt: dir)

        let fm = FileManager.default
        guard let enumerator = fm.enumerator(at: dir, includingPropertiesForKeys: nil) else {
            Issue.record("failed to enumerate collection directory")
            return
        }
        let fileURLs = (enumerator.allObjects as? [URL]) ?? []
        for fileURL in fileURLs {
            var isDirectory: ObjCBool = false
            fm.fileExists(atPath: fileURL.path, isDirectory: &isDirectory)
            guard !isDirectory.boolValue, let contents = try? String(contentsOf: fileURL, encoding: .utf8) else { continue }
            #expect(!contents.contains(secretValue))
        }

        let envFile = EnvironmentStore.environmentsDirectory(forCollectionAt: dir).appendingPathComponent("prod.hakka")
        let envContents = try String(contentsOf: envFile, encoding: .utf8)
        #expect(envContents.contains(secretValue))
    }
}
