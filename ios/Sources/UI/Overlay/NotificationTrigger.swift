#if canImport(UIKit)
import Foundation
import UserNotifications
import UIKit
import HakkaCommon
import HakkaNetwork

// MARK: - NotificationTrigger

/// Displays a local notification when the app backgrounds, showing captured request count.
/// Tapping the notification opens the Hakka overlay.
///
/// This is the iOS equivalent of Android's HakkaNotificationManager.
/// Use this for standalone Swift apps using hakka-ios directly.
///
/// - Note: The notification is posted on `UIApplication.didEnterBackgroundNotification`.
///   Call `requestAuthorization()` at app launch to prompt for notification permissions.
@MainActor
public final class NotificationTrigger: NSObject {

    // MARK: - Notification IDs

    private static let categoryIdentifier = "com.noodleapps.hakka.NETWORK_LOGS"
    private static let notificationIdentifier = "hakka_network_logs"

    // MARK: - Singleton

    public static let shared = NotificationTrigger()

    // MARK: - Properties

    private var requestCount = 0
    private var errorCount = 0
    private var isAuthorized = false

    // MARK: - Initialization

    private override init() {
        super.init()
        setupNotificationCategory()
        observeAppLifecycle()
    }

    // MARK: - Authorization

    /// Request notification authorization. Call once at app launch.
    ///
    /// Optional — a host app that already holds notification permission does not
    /// need to call this; `isAuthorized` is refreshed from the system on every
    /// activation. Call it only when you want Hakka to trigger the prompt.
    public func requestAuthorization() {
        Task {
            do {
                let granted = try await UNUserNotificationCenter.current()
                    .requestAuthorization(options: [.alert, .sound, .badge])
                isAuthorized = granted
                #if DEBUG
                if !granted {
                    print("[Hakka] Notifications not authorized — the overlay can still be opened by shake.")
                }
                #endif
            } catch {
                #if DEBUG
                print("[Hakka] Notification authorization failed: \(error.localizedDescription)")
                #endif
            }
        }
    }

    /// Re-read the live authorization state.
    ///
    /// Done on activation rather than lazily at post time: `didEnterBackground`
    /// gives a very short window before suspension, and an async hop there can
    /// miss it entirely. Refreshing while the app is active means the flag is
    /// already current when the background notification fires.
    private func refreshAuthorizationStatus() {
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                isAuthorized = true
            default:
                isAuthorized = false
            }
        }
    }

    // MARK: - Count Updates

    /// Call this when a new request is captured.
    public func onRequest() {
        requestCount += 1
    }

    /// Call this when a response with 4xx/5xx status is captured.
    public func onError() {
        errorCount += 1
    }

    /// Reset counts to zero (e.g., when user clears the log).
    public func resetCounts() {
        requestCount = 0
        errorCount = 0
    }

    // MARK: - Private

    private func setupNotificationCategory() {
        let center = UNUserNotificationCenter.current()

        let openAction = UNNotificationAction(
            identifier: "OPEN_ACTION",
            title: "Open",
            options: [.foreground]
        )

        let clearAction = UNNotificationAction(
            identifier: "CLEAR_ACTION",
            title: "Clear",
            options: [.destructive]
        )

        let category = UNNotificationCategory(
            identifier: Self.categoryIdentifier,
            actions: [openAction, clearAction],
            intentIdentifiers: [],
            options: []
        )

        center.setNotificationCategories([category])
    }

    private func observeAppLifecycle() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )

        // Keeps `isAuthorized` honest for hosts that already hold permission and
        // never call `requestAuthorization()` themselves.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
        refreshAuthorizationStatus()

        // Handle notification tap — only take the delegate if nobody else has it,
        // to avoid silently breaking the host app's notification handling.
        let center = UNUserNotificationCenter.current()
        if center.delegate == nil {
            center.delegate = self
        } else {
            #if DEBUG
            print("[Hakka] UNUserNotificationCenter already has a delegate — notification "
                + "tap-to-open is disabled. Call OverlayWindow.shared.show() yourself.")
            #endif
        }
    }

    @objc private func appDidBecomeActive() {
        refreshAuthorizationStatus()
    }

    @objc private func appDidEnterBackground() {
        guard isAuthorized, requestCount > 0 else { return }
        postNotification()
    }

    private func postNotification() {
        let center = UNUserNotificationCenter.current()

        let content = UNMutableNotificationContent()
        content.title = "Hakka"

        if errorCount > 0 {
            content.body = "\(requestCount) requests, \(errorCount) errors"
        } else {
            content.body = "\(requestCount) requests"
        }

        content.sound = .default
        content.categoryIdentifier = Self.categoryIdentifier

        let request = UNNotificationRequest(
            identifier: Self.notificationIdentifier,
            content: content,
            trigger: nil // Deliver immediately
        )

        center.add(request) { error in
            #if DEBUG
            if let error = error {
                print("[Hakka] Failed to post notification: \(error.localizedDescription)")
            }
            #endif
        }
    }

    /// Cancel any pending notifications.
    public func cancelNotifications() {
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        resetCounts()
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationTrigger: @preconcurrency UNUserNotificationCenterDelegate {

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        switch response.actionIdentifier {
        case "OPEN_ACTION", UNNotificationDefaultActionIdentifier:
            OverlayWindow.shared.show()

        case "CLEAR_ACTION":
            HakkaInterceptor.shared.clear()
            cancelNotifications()

        default:
            break
        }

        completionHandler()
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([])
    }
}
#endif // canImport(UIKit)
