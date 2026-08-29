import CryptoKit
import Foundation
import Security

/// Failure modes from a `SecretKeychainStore` call. `LocalizedError` so
/// `EnvironmentModel` (which surfaces `error.localizedDescription` verbatim)
/// shows something a user can act on rather than a bare `OSStatus`.
public enum SecretKeychainError: Error, Sendable, Equatable, LocalizedError {
    /// The item this call asked for does not exist — a deleted variable
    /// whose reference token survived, a secret created on another machine
    /// with a different Keychain, or an item removed outside the app (e.g.
    /// via Keychain Access). Distinct from `unexpectedStatus` because
    /// callers report it differently: a missing secret is expected and
    /// recoverable (re-enter it), not a Keychain malfunction.
    case itemNotFound
    /// The item exists but its stored bytes are not valid UTF-8 text —
    /// should be unreachable since this store only ever writes UTF-8, but a
    /// third party (or a future format change) could leave one behind.
    case corruptItem
    case unexpectedStatus(OSStatus)

    public var errorDescription: String? {
        switch self {
        case .itemNotFound:
            "This secret isn't in the Keychain. It may have been removed outside Hakka. Re-enter its value."
        case .corruptItem:
            "The Keychain item for this secret is unreadable."
        case let .unexpectedStatus(status):
            if let message = SecCopyErrorMessageString(status, nil) as String? {
                "Keychain error: \(message) (\(status))"
            } else {
                "Keychain error \(status)."
            }
        }
    }
}

/// SecItem-backed storage for one `EnvironmentVariable.value` where
/// `secret == true`. `EnvironmentStore` is the only caller: it writes a
/// reference token to the `.hakka` file in place of a secret's real value
/// and uses this store to hold the value itself, keyed stably per
/// (collection directory, environment, variable) so a rename of either
/// never orphans or loses an item — only a deleted variable, an
/// unmarked-secret variable, or a deleted environment should ever cause a
/// delete, and `EnvironmentStore.save` is what does that reconciliation.
///
/// One `kSecClassGenericPassword` item per secret, scoped by
/// `kSecAttrService` to this app. No `kSecAttrAccessGroup` is set, so items
/// are private to this app's Keychain access group — never shared with
/// another app, never a step towards one.
public actor SecretKeychainStore {
    public init() {}

    /// Creates the item if absent, overwrites it in place if present. Never
    /// leaves two items for the same identity — `SecItemUpdate` first, and
    /// only falls back to `SecItemAdd` on `errSecItemNotFound`.
    public func save(_ value: String, collection: URL, environmentID: String, variableID: String) throws {
        let account = Self.account(collection: collection, environmentID: environmentID, variableID: variableID)
        let data = Data(value.utf8)

        let updateStatus = SecItemUpdate(
            Self.query(account: account) as CFDictionary,
            [kSecValueData as String: data] as CFDictionary,
        )
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var addQuery = Self.query(account: account)
            addQuery[kSecValueData as String] = data
            // `AfterFirstUnlockThisDeviceOnly`: readable once the user has
            // unlocked their Mac since boot (so a launch-at-login capture
            // session can still resolve secrets), and never included in an
            // iCloud Keychain sync or backup — an API key silently
            // following a user's Apple ID to another machine is a surprise
            // this app should never spring on them.
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw SecretKeychainError.unexpectedStatus(addStatus) }
        default:
            throw SecretKeychainError.unexpectedStatus(updateStatus)
        }
    }

    public func read(collection: URL, environmentID: String, variableID: String) throws -> String {
        let account = Self.account(collection: collection, environmentID: environmentID, variableID: variableID)
        var query = Self.query(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else {
            throw status == errSecItemNotFound
                ? SecretKeychainError.itemNotFound
                : SecretKeychainError.unexpectedStatus(status)
        }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw SecretKeychainError.corruptItem
        }
        return value
    }

    /// Idempotent — deleting an identity with no item is not an error, so
    /// callers reconciling a list of "no longer secret" ids don't need to
    /// check existence first.
    public func delete(collection: URL, environmentID: String, variableID: String) throws {
        let account = Self.account(collection: collection, environmentID: environmentID, variableID: variableID)
        let status = SecItemDelete(Self.query(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecretKeychainError.unexpectedStatus(status)
        }
    }

    // MARK: - Key derivation

    /// Shared by every item this store writes — scopes them to this app in
    /// Keychain Access without requesting a keychain-access-group entitlement.
    private static let service = "app.hakka.environment-secret"

    private static func query(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    /// `sha256(collection path) . environmentID . variableID`. The path is
    /// hashed rather than stored verbatim so a local filesystem path —
    /// which embeds the macOS account name — never appears in Keychain
    /// Access's plainly-browsable account column; `environmentID` and
    /// `variableID` are already-opaque UUIDs, so they need no such
    /// treatment. Using the ids (not the current names) is what makes
    /// renaming a variable or an environment a non-event: the id is stable,
    /// so the same item keeps being found under the same key.
    private static func account(collection: URL, environmentID: String, variableID: String) -> String {
        let digest = SHA256.hash(data: Data(collection.standardizedFileURL.path.utf8))
        let pathHex = Data(digest).map { String(format: "%02x", $0) }.joined()
        return "\(pathHex).\(environmentID).\(variableID)"
    }
}
