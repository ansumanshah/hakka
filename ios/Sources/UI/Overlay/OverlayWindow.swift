#if canImport(UIKit)
import Foundation
import SwiftUI
import UIKit
import HakkaCommon
import HakkaNetwork

// MARK: - OverlayWindow

/// Presents the Hakka network inspector as a sheet with a custom 60%/large
/// detent pair. Starts at 60%, user pulls up to full screen. 60% is a fixed
/// fraction (not UIKit's system `.medium()`, which is ~50% and not tunable)
/// so it matches Android's own 60%/92% mobile detents instead of drifting
/// to a third, system-defined value.
///
/// Usage:
/// ```swift
/// OverlayWindow.shared.show()
/// OverlayWindow.shared.hide()
/// OverlayWindow.shared.toggle()
/// ```
@MainActor
public final class OverlayWindow {

    // MARK: - Singleton

    public static let shared = OverlayWindow()

    // MARK: - Properties

    private var presentingWindow: UIWindow?
    private weak var sheetController: UIViewController?
    /// Set synchronously the moment `hide()` calls `dismiss(animated:)`,
    /// cleared only in that dismissal's completion handler. `show()` /
    /// `showFullscreen()` / `showMonitor()` / `toggle()` all gate on this
    /// (in addition to `sheetController?.presentingViewController`) because
    /// UIKit's own timing for clearing `presentingViewController` during a
    /// dismiss transition isn't documented/guaranteed — this flag is the
    /// only signal in this file's control, so it's the one the guards trust.
    private var isDismissing = false

    // MARK: - Initialization

    private init() {}

    // MARK: - Detents

    /// 60% of the sheet's maximum height — replaces UIKit's system `.medium()`
    /// (~50%, fixed) so this detent's fraction actually matches the other
    /// mobile platforms instead of being whatever Apple's system detent
    /// happens to render as. `.custom` requires iOS 16+, which matches this
    /// package's deployment target (`ios/Package.swift`).
    private static func makeMediumDetent() -> UISheetPresentationController.Detent {
        .custom(identifier: .init("hakkaMedium")) { context in context.maximumDetentValue * 0.6 }
    }

    // MARK: - Public API

    /// Show the inspector sheet.
    public func show() {
        if isDismissing || sheetController?.presentingViewController != nil { return }

        guard let windowScene = UIApplication.shared.activeWindowScene,
            let rootVC = windowScene.keyWindow?.rootViewController
        else { return }

        var topVC = rootVC
        while let presented = topVC.presentedViewController {
            topVC = presented
        }

        let inspectorView = InspectorView(onDismiss: { [weak self] in
            self?.hide()
        })

        let hostingController = UIHostingController(rootView: inspectorView)
        hostingController.overrideUserInterfaceStyle = Self.appearanceOverride

        if let sheet = hostingController.sheetPresentationController {
            sheet.detents = [Self.makeMediumDetent(), .large()]
            sheet.prefersGrabberVisible = true
            sheet.prefersScrollingExpandsWhenScrolledToEdge = true
        }

        hostingController.presentationController?.delegate = SheetDismissDelegate.shared
        BubbleWindow.shared.setHiddenForOverlay(true)
        topVC.present(hostingController, animated: true)
        self.sheetController = hostingController
    }

    /// A host app's `.preferredColorScheme` cascades into every sheet it
    /// presents (via `overrideUserInterfaceStyle`) unless the presented
    /// controller overrides it. Reading `-hakkaLightMode` directly, instead
    /// of inheriting the host's scheme, lets the Inspector be QA'd in light
    /// mode independent of whatever the host forces.
    static var appearanceOverride: UIUserInterfaceStyle {
        ProcessInfo.processInfo.arguments.contains("-hakkaLightMode") ? .light : .unspecified
    }

    /// Hide the inspector sheet.
    public func hide() {
        guard !isDismissing, let controller = sheetController else { return }
        // `isDismissing` is set here, synchronously, and only cleared in the
        // completion below — the `show()`/`showFullscreen()`/`showMonitor()`/
        // `toggle()` guards all read it to detect an in-flight dismissal.
        // This doesn't rely on `presentingViewController` going nil at any
        // particular point during the transition (undocumented UIKit
        // timing); it's this file's own synchronous flag, so a show()/
        // toggle() call anywhere in the ~0.3s animation window is reliably
        // rejected instead of racing to `present` on a mid-dismiss controller.
        isDismissing = true
        controller.dismiss(animated: true) { [weak self] in
            NotificationCenter.default.post(name: .init("HakkaOverlayDismissed"), object: nil)
            BubbleWindow.shared.setHiddenForOverlay(false)
            if self?.sheetController === controller {
                self?.sheetController = nil
            }
            self?.isDismissing = false
        }
    }

    /// Show the inspector as a fullscreen sheet (large detent only, no half-sheet).
    public func showFullscreen() {
        if isDismissing || sheetController?.presentingViewController != nil { return }

        guard let windowScene = UIApplication.shared.activeWindowScene,
            let rootVC = windowScene.keyWindow?.rootViewController
        else { return }

        var topVC = rootVC
        while let presented = topVC.presentedViewController {
            topVC = presented
        }

        let inspectorView = InspectorView(onDismiss: { [weak self] in
            self?.hide()
        })

        let hostingController = UIHostingController(rootView: inspectorView)
        hostingController.overrideUserInterfaceStyle = Self.appearanceOverride

        if let sheet = hostingController.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
            sheet.prefersScrollingExpandsWhenScrolledToEdge = true
        }

        hostingController.presentationController?.delegate = SheetDismissDelegate.shared
        BubbleWindow.shared.setHiddenForOverlay(true)
        topVC.present(hostingController, animated: true)
        self.sheetController = hostingController
    }

    /// Show the inspector directly on its Stats tab. Stats/Dashboard is a
    /// first-class Inspector tab, not a separate standalone sheet, so this
    /// opens the same Inspector as `show()`, pre-selected to Stats instead
    /// of presenting `DashboardView` solo.
    public func showMonitor() {
        if isDismissing || sheetController?.presentingViewController != nil { return }

        guard let windowScene = UIApplication.shared.activeWindowScene,
            let rootVC = windowScene.keyWindow?.rootViewController
        else { return }

        var topVC = rootVC
        while let presented = topVC.presentedViewController {
            topVC = presented
        }

        let inspectorView = InspectorView(
            onDismiss: { [weak self] in self?.hide() },
            initialTab: .stats
        )
        let hostingController = UIHostingController(rootView: inspectorView)
        hostingController.overrideUserInterfaceStyle = Self.appearanceOverride

        if let sheet = hostingController.sheetPresentationController {
            sheet.detents = [Self.makeMediumDetent(), .large()]
            sheet.prefersGrabberVisible = true
            sheet.prefersScrollingExpandsWhenScrolledToEdge = true
        }

        hostingController.presentationController?.delegate = SheetDismissDelegate.shared
        BubbleWindow.shared.setHiddenForOverlay(true)
        topVC.present(hostingController, animated: true)
        self.sheetController = hostingController
    }

    /// Toggle visibility.
    public func toggle() {
        if isDismissing { return }
        if sheetController?.presentingViewController != nil {
            hide()
        } else {
            show()
        }
    }
}
// MARK: - Sheet Dismiss Delegate

/// Detects swipe-to-dismiss so the bubble can re-appear.
private class SheetDismissDelegate: NSObject, UIAdaptivePresentationControllerDelegate {
    static let shared = SheetDismissDelegate()

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        NotificationCenter.default.post(name: .init("HakkaOverlayDismissed"), object: nil)
        BubbleWindow.shared.setHiddenForOverlay(false)
    }
}
#endif // canImport(UIKit)
