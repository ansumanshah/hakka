import Foundation
import Testing
@testable import HakkaCore

/// Exercises the real macOS Keychain (`SecItemAdd`/`SecItemCopyMatching`/
/// `SecItemDelete`), not a fake — this store's entire job is being a thin,
/// correct wrapper over that API, so a mock would test nothing real. Every
/// test uses a fresh UUID for `environmentID`/`variableID` (and usually a
/// fresh collection URL too) so runs never collide with each other or with
/// anything already in the developer's login keychain, and every test
/// deletes what it wrote — via `defer`, so a failing `#expect` still cleans
/// up — leaving no residue behind.
@Suite("SecretKeychainStore")
struct SecretKeychainStoreTests {
    private func collectionURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("hakka-keychain-tests-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("Collection", isDirectory: true)
    }

    @Test func roundTripsASavedValueThroughSecItemAddAndCopyMatching() async throws {
        let store = SecretKeychainStore()
        let collection = collectionURL()
        let environmentID = UUID().uuidString
        let variableID = UUID().uuidString
        defer { Task { try? await store.delete(collection: collection, environmentID: environmentID, variableID: variableID) } }

        try await store.save("sk-super-secret-9f2c", collection: collection, environmentID: environmentID, variableID: variableID)
        let read = try await store.read(collection: collection, environmentID: environmentID, variableID: variableID)

        #expect(read == "sk-super-secret-9f2c")
    }

    /// A second `save` for the same identity must overwrite the existing
    /// item (`SecItemUpdate`) rather than fail or duplicate — this is what
    /// lets `EnvironmentStore.save` call `save` unconditionally on every
    /// secret variable, every time, without first checking whether an item
    /// already exists.
    @Test func savingTwiceOverwritesRatherThanFailingOrDuplicating() async throws {
        let store = SecretKeychainStore()
        let collection = collectionURL()
        let environmentID = UUID().uuidString
        let variableID = UUID().uuidString
        defer { Task { try? await store.delete(collection: collection, environmentID: environmentID, variableID: variableID) } }

        try await store.save("first-value", collection: collection, environmentID: environmentID, variableID: variableID)
        try await store.save("second-value", collection: collection, environmentID: environmentID, variableID: variableID)
        let read = try await store.read(collection: collection, environmentID: environmentID, variableID: variableID)

        #expect(read == "second-value")
    }

    @Test func deleteRemovesTheItemSoASubsequentReadThrowsItemNotFound() async throws {
        let store = SecretKeychainStore()
        let collection = collectionURL()
        let environmentID = UUID().uuidString
        let variableID = UUID().uuidString

        try await store.save("goes-away", collection: collection, environmentID: environmentID, variableID: variableID)
        try await store.delete(collection: collection, environmentID: environmentID, variableID: variableID)

        do {
            _ = try await store.read(collection: collection, environmentID: environmentID, variableID: variableID)
            Issue.record("expected .itemNotFound after delete")
        } catch SecretKeychainError.itemNotFound {
            // expected
        }
    }

    /// Idempotent by design — `EnvironmentStore.save` deletes a set of
    /// "no longer secret" ids without checking which of them ever actually
    /// reached the Keychain, so a delete of an identity that was never
    /// saved (or already deleted) must not throw.
    @Test func deletingAnIdentityThatWasNeverSavedDoesNotThrow() async throws {
        let store = SecretKeychainStore()
        try await store.delete(collection: collectionURL(), environmentID: UUID().uuidString, variableID: UUID().uuidString)
    }

    @Test func readingAnIdentityThatWasNeverSavedThrowsItemNotFound() async throws {
        let store = SecretKeychainStore()
        do {
            _ = try await store.read(collection: collectionURL(), environmentID: UUID().uuidString, variableID: UUID().uuidString)
            Issue.record("expected .itemNotFound")
        } catch SecretKeychainError.itemNotFound {
            // expected
        }
    }

    /// The account key folds in the collection directory precisely so two
    /// collections that happen to reuse the same environment/variable id
    /// pair — a duplicated collection folder, say — never read or delete
    /// each other's secret.
    @Test func sameEnvironmentAndVariableIDInDifferentCollectionsAreIndependent() async throws {
        let store = SecretKeychainStore()
        let environmentID = UUID().uuidString
        let variableID = UUID().uuidString
        let collectionA = collectionURL()
        let collectionB = collectionURL()
        defer {
            Task {
                try? await store.delete(collection: collectionA, environmentID: environmentID, variableID: variableID)
                try? await store.delete(collection: collectionB, environmentID: environmentID, variableID: variableID)
            }
        }

        try await store.save("value-in-a", collection: collectionA, environmentID: environmentID, variableID: variableID)
        try await store.save("value-in-b", collection: collectionB, environmentID: environmentID, variableID: variableID)

        #expect(try await store.read(collection: collectionA, environmentID: environmentID, variableID: variableID) == "value-in-a")
        #expect(try await store.read(collection: collectionB, environmentID: environmentID, variableID: variableID) == "value-in-b")

        try await store.delete(collection: collectionA, environmentID: environmentID, variableID: variableID)
        #expect(try await store.read(collection: collectionB, environmentID: environmentID, variableID: variableID) == "value-in-b")
    }
}
