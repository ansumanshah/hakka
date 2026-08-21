import Foundation
#if canImport(AppKit)
import AppKit
#endif

/// Opens the authorization URL in the user's real, already-logged-in
/// browser — never an embedded webview. That's the whole trust posture of
/// the authorization-code grant here: Hakka never sees the user's
/// credentials, only the redirect it gets back.
public protocol OAuth2BrowserLaunching: Sendable {
    func open(_ url: URL) async throws
}

public struct SystemBrowserLauncher: OAuth2BrowserLaunching {
    public init() {}

    public func open(_ url: URL) async throws {
        #if canImport(AppKit)
        guard await MainActor.run(body: { NSWorkspace.shared.open(url) }) else {
            throw OAuth2FlowError.browserLaunchFailed
        }
        #else
        throw OAuth2FlowError.browserLaunchFailed
        #endif
    }
}
