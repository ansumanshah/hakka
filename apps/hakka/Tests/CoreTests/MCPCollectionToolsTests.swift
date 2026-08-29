import Foundation
import Testing

@testable import HakkaCore
@testable import HakkaServer

/// Points `MCPCollectionSource` at a fixed list of directories — the real
/// stand-in for whatever the app layer wires `CollectionModel`'s
/// `directoryURL` up to at server-start time (see `MCPCollectionSource.swift`'s
/// doc comment). No UI, no `MainActor`, just URLs.
private struct FakeDirectoryProvider: MCPCollectionDirectoryProvider {
    let directories: [URL]
    func collectionDirectories() async -> [URL] { directories }
}

/// Writes a real collection to disk via `CollectionStore` (the same store
/// the app uses) rather than hand-crafting `.hakka` files — proves these
/// tools read whatever the app actually wrote, not a parallel fixture
/// format that could drift from it.
private func writeFixtureCollection(to directory: URL) async throws -> (collection: Collection, requestID: String, nestedID: String) {
    let rootRequest = RequestSpec(name: "Get widgets", method: .get, url: "https://api.example.com/widgets")
    let nestedRequest = RequestSpec(name: "Create widget", method: .post, url: "https://api.example.com/widgets")
    let folder = Folder(name: "Widgets", children: [.request(nestedRequest)])
    let collection = Collection(name: "Example API", nodes: [.request(rootRequest), .folder(folder)])
    try await CollectionStore().save(collection, to: directory)
    return (collection, rootRequest.id, nestedRequest.id)
}

private func tempDir() -> URL {
    URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("hakka-mcp-collections-\(UUID().uuidString)")
}

@Suite("MCPListCollectionsTool")
struct MCPListCollectionsToolTests {
    @Test("lists an open collection with its request/folder counts")
    func listsOpenCollection() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let fixture = try await writeFixtureCollection(to: dir)

        let source = MCPCollectionSource(provider: FakeDirectoryProvider(directories: [dir]))
        let result = await MCPListCollectionsTool(source: source).call(.object([:]))
        let payload = decodeJSON(result)

        #expect(payload["count"]?.intValue == 1)
        let entry = payload["collections"]?.arrayValue?.first
        #expect(entry?["id"]?.stringValue == fixture.collection.id)
        #expect(entry?["name"]?.stringValue == "Example API")
        // Root request + the one nested under "Widgets" = 2; one folder.
        #expect(entry?["requestCount"]?.intValue == 2)
        #expect(entry?["folderCount"]?.intValue == 1)
    }

    @Test("no open directories reports zero collections, not an error")
    func noDirectoriesReportsZero() async {
        let source = MCPCollectionSource(provider: FakeDirectoryProvider(directories: []))
        let payload = decodeJSON(await MCPListCollectionsTool(source: source).call(.object([:])))
        #expect(payload["count"]?.intValue == 0)
    }

    @Test("a directory that fails to load is reported per-entry, not as a whole-call failure")
    func unloadableDirectoryIsPerEntryError() async {
        let missing = tempDir() // never written to — no collection.hakka
        let source = MCPCollectionSource(provider: FakeDirectoryProvider(directories: [missing]))
        let payload = decodeJSON(await MCPListCollectionsTool(source: source).call(.object([:])))
        let entry = payload["collections"]?.arrayValue?.first
        #expect(entry?["error"]?.stringValue != nil)
        #expect(entry?["directory"]?.stringValue == missing.path)
    }
}

@Suite("MCPGetCollectionRequestTool")
struct MCPGetCollectionRequestToolTests {
    @Test("finds a root-level request by id")
    func findsRootRequest() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let fixture = try await writeFixtureCollection(to: dir)

        let source = MCPCollectionSource(provider: FakeDirectoryProvider(directories: [dir]))
        let result = await MCPGetCollectionRequestTool(source: source).call(.object(["id": .string(fixture.requestID)]))
        #expect(result.isError == false)
        let payload = decodeJSON(result)
        #expect(payload["id"]?.stringValue == fixture.requestID)
        #expect(payload["method"]?.stringValue == "GET")
    }

    @Test("finds a request nested inside a folder")
    func findsNestedRequest() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let fixture = try await writeFixtureCollection(to: dir)

        let source = MCPCollectionSource(provider: FakeDirectoryProvider(directories: [dir]))
        let result = await MCPGetCollectionRequestTool(source: source).call(.object(["id": .string(fixture.nestedID)]))
        #expect(decodeJSON(result)["method"]?.stringValue == "POST")
    }

    @Test("an unknown id is a not_found tool error")
    func unknownIDIsNotFound() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        _ = try await writeFixtureCollection(to: dir)

        let source = MCPCollectionSource(provider: FakeDirectoryProvider(directories: [dir]))
        let result = await MCPGetCollectionRequestTool(source: source).call(.object(["id": .string("no-such-id")]))
        #expect(result.isError == true)
        #expect(decodeJSON(result)["error"]?.stringValue == "not_found")
    }

    @Test("collectionId restricts the search to one collection")
    func collectionIDRestrictsSearch() async throws {
        let dirA = tempDir()
        let dirB = tempDir()
        defer {
            try? FileManager.default.removeItem(at: dirA)
            try? FileManager.default.removeItem(at: dirB)
        }
        let fixtureA = try await writeFixtureCollection(to: dirA)
        let fixtureB = try await writeFixtureCollection(to: dirB)

        let source = MCPCollectionSource(provider: FakeDirectoryProvider(directories: [dirA, dirB]))
        // fixtureA's request id searched under fixtureB's collectionId should not match.
        let result = await MCPGetCollectionRequestTool(source: source).call(.object([
            "id": .string(fixtureA.requestID), "collectionId": .string(fixtureB.collection.id),
        ]))
        #expect(result.isError == true)
    }
}
