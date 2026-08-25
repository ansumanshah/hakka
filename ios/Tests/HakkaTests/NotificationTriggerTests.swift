#if canImport(UIKit)
import Foundation
import Testing
import UIKit
@testable import HakkaUI

// MARK: - NotificationTriggerTests

/// Regression coverage for the backgrounding-count-reset bug: counts must
/// survive a transient resign/become-active cycle that never actually
/// backgrounds the app (Control Center, Notification Center pull-down, an
/// incoming call banner, a permission prompt, an App Store sheet) and must
/// only clear on a genuine background -> foreground return.
@Suite("NotificationTrigger background reset", .serialized)
@MainActor
struct NotificationTriggerTests {

    @Test("didBecomeActive without a real background transition preserves counts")
    func preservesCountsAcrossTransientInterruption() {
        let trigger = NotificationTrigger.shared
        trigger.resetCounts()
        trigger.onRequest()
        trigger.onRequest()
        trigger.onError()

        // Simulates Control Center / Notification Center pull-down / a Face ID
        // prompt: `didBecomeActive` fires without the app ever having entered
        // background (`didEnterBackground` is never posted in that flow).
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)

        #expect(trigger.requestCount == 2)
        #expect(trigger.errorCount == 1)
    }

    @Test("willEnterForeground after a real background clears counts")
    func resetsCountsOnGenuineForegroundReturn() {
        let trigger = NotificationTrigger.shared
        trigger.resetCounts()
        trigger.onRequest()
        trigger.onError()

        // `willEnterForeground` only fires after a real `didEnterBackground`,
        // so this models the app actually backgrounding and returning.
        NotificationCenter.default.post(name: UIApplication.willEnterForegroundNotification, object: nil)

        #expect(trigger.requestCount == 0)
        #expect(trigger.errorCount == 0)
    }
}
#endif // canImport(UIKit)
