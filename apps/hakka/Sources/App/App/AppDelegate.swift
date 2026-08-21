import AppKit

/// Owns the one thing SwiftUI's own scene lifecycle cannot guarantee:
/// `applicationShouldTerminate` can hold the process open (`.terminateLater`)
/// long enough to send `breakpoint.abort` for every outstanding pause before
/// the app actually exits — see `PauseInboxModel.abortAllForTermination`'s
/// "DECISION 3" doc comment for why this must exist at all. `.task`'s
/// cancellation-on-disappear alone is not enough here: SwiftUI cancels a
/// scene's `.task` when the window closes, with no guaranteed opportunity to
/// await a network send before the process itself exits, and would still
/// need explicit re-plumbing into `NSApplication`'s own shutdown sequence to
/// delay it — an `NSApplicationDelegate` is the direct route to that.
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Set once by `HakkaApp` right after `AppModel` is constructed —
    /// `AppDelegate` is instantiated by `@NSApplicationDelegateAdaptor`
    /// before `AppModel` exists, so this cannot be injected via `init`.
    var pauseInbox: PauseInboxModel?

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let pauseInbox, pauseInbox.hasPending else { return .terminateNow }
        Task { @MainActor in
            await pauseInbox.abortAllForTermination()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}
