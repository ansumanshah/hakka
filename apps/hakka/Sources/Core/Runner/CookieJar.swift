import Foundation
import os

/// The runner's cookie-jar seam. Protocol-based so tests install a fake that
/// never touches `HTTPCookieStorage`; `CookieJar` is the real implementation.
public protocol CookieStoring: Sendable {
    /// Whether the jar currently stores and yields cookies. Flipping this off
    /// keeps the stored contents but stops sends from carrying them.
    var isEnabled: Bool { get }
    /// Cookies a send to `url` should carry — already narrowed by the
    /// storage's domain/path/scheme matching. Empty when the jar is disabled.
    func cookies(for url: URL) -> [HTTPCookie]
    /// Lands response cookies in the jar, scoped to `url`. A no-op when the
    /// jar is disabled.
    func setCookies(_ cookies: [HTTPCookie], for url: URL)
    /// Everything stored, across all domains — what a future Cookies tab lists.
    func allCookies() -> [HTTPCookie]
    /// Turns storing and attaching on or off without dropping stored cookies.
    func setEnabled(_ enabled: Bool)
    /// Removes every stored cookie.
    func clear()
}

/// The inspector's cookie jar: an explicit, inspectable, controllable wrapper
/// around a *private* `HTTPCookieStorage`.
///
/// Decision — private storage, not `HTTPCookieStorage.shared`: the transport's
/// previous `URLSession.shared` default silently read and wrote the
/// process-wide jar, so inspector sends inherited cookies deposited by other
/// code in the process and deposited their `Set-Cookie` values where that code
/// would send them. A private instance keeps inspector sends hermetic, makes
/// disable and clear affect only the inspector, and shows a future Cookies
/// tab exactly what its own sends carried — not what the rest of the process
/// stored. Every `CookieJar()` vends its own storage, so jars never see each
/// other's cookies either.
///
/// `@unchecked Sendable`: both fields carry their own synchronization —
/// `HTTPCookieStorage` serializes its state internally, and the enabled flag
/// rides an unfair lock — so there is no unsynchronized shared state left.
public final class CookieJar: CookieStoring, @unchecked Sendable {
    private let storage: HTTPCookieStorage
    private let enabled = OSAllocatedUnfairLock(initialState: true)

    /// `storage` is injectable for callers that bring their own private
    /// `HTTPCookieStorage`; the default is a fresh private one.
    public init(storage: HTTPCookieStorage? = nil) {
        self.storage = storage ?? CookieJar.newPrivateStorage()
    }

    public var isEnabled: Bool {
        enabled.withLock { $0 }
    }

    public func setEnabled(_ enabled: Bool) {
        self.enabled.withLock { $0 = enabled }
    }

    public func cookies(for url: URL) -> [HTTPCookie] {
        guard isEnabled else { return [] }
        return storage.cookies(for: url) ?? []
    }

    public func setCookies(_ cookies: [HTTPCookie], for url: URL) {
        guard isEnabled, cookies.isEmpty == false else { return }
        // The singular API, not `setCookies(_:for:mainDocumentURL:)`: the
        // plural one honors the storage's `.never` accept policy (meant to
        // stop sessions from self-storing) and would silently drop everything.
        // The cookies arrive already URL-scoped from `CookieWire`'s parse.
        for cookie in cookies {
            storage.setCookie(cookie)
        }
    }

    /// Lists stored cookies even while disabled — inspecting the jar's
    /// contents is separate from whether sends carry them.
    public func allCookies() -> [HTTPCookie] {
        storage.cookies ?? []
    }

    public func clear() {
        for cookie in storage.cookies ?? [] {
            storage.deleteCookie(cookie)
        }
    }

    /// A session configuration whose cookie storage is this jar's backing
    /// store, with the session's own cookie machinery switched off:
    /// `httpShouldSetCookies` is false so it never attaches, and the storage's
    /// accept policy is `.never` so it never self-stores. `RequestRunner`
    /// stores `Set-Cookie` and attaches `Cookie` headers itself through the
    /// jar, so exactly one layer touches cookies no matter which transport is
    /// injected — the session never adds a second `Cookie` header or stores
    /// behind the jar's back. The binding is what a future per-run re-enable
    /// of session-level handling would plug into.
    public func makeSessionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = storage
        configuration.httpShouldSetCookies = false
        return configuration
    }

    /// A private, empty cookie storage that never self-accepts cookies from a
    /// session — the jar's accept policy is `.never` because the runner, not
    /// the session, decides what lands in the jar.
    ///
    /// Derived from an `URLSessionConfiguration.ephemeral` configuration —
    /// the supported source of a working per-use `HTTPCookieStorage`. A bare
    /// `HTTPCookieStorage()` allocates but never matches cookies back, and
    /// `HTTPCookieStorage.shared` is the process-wide jar this class exists
    /// to avoid; the fallback only keeps `init` total if an ephemeral
    /// configuration ever stopped vending a storage.
    private static func newPrivateStorage() -> HTTPCookieStorage {
        guard let storage = URLSessionConfiguration.ephemeral.httpCookieStorage else {
            return HTTPCookieStorage.shared
        }
        storage.cookieAcceptPolicy = .never
        return storage
    }
}
