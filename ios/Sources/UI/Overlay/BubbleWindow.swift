#if canImport(UIKit)
import Foundation
import UIKit
import HakkaCommon
import HakkaNetwork
import HakkaPerformance

// MARK: - PassthroughWindow

// Internal, not private: `BubbleWindow.window` is an internal property of this
// type, and a property may not be more visible than its type.
class PassthroughWindow: UIWindow {
    var bubbleView: UIView?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let bubbleView, bubbleView.frame.contains(point) else { return nil }
        return bubbleView.hitTest(convert(point, to: bubbleView), with: event)
    }
}

// MARK: - BubbleWindow
//
// The floating HUD bubble is split across files (all `extension BubbleWindow`
// in this directory, plus the value types it depends on):
//   - BubbleWindow.swift        — this file: hosting/lifecycle + public API
//   - BubbleWindowDisplay.swift — stats model + label/color rendering
//   - BubbleWindowConstruction.swift — one-time view/gesture construction
//   - BubbleWindowRuntime.swift — idle fade, store polling, perf metrics, keyboard
//   - BubbleWindowGestures.swift — tap/long-press/drag handling, expand/snap
//
// Stored properties must live here (extensions can't add storage), so most
// of them carry no access modifier (internal) even though only one other
// file touches them — that's the price of the split, not a design change.

@MainActor
public final class BubbleWindow {

    public static let shared = BubbleWindow()

    let bubbleWidth: CGFloat = 244
    let bubbleHeight: CGFloat = 58
    let bubbleCornerRadius: CGFloat = 18
    let edgeInset: CGFloat = 12
    let hideZoneHeight: CGFloat = 80
    let idleDelay: TimeInterval = 3.0
    let idleAlpha: CGFloat = 0.62

    var window: PassthroughWindow?
    var bubbleView: UIView?
    var effectView: UIVisualEffectView?
    var numeratorLabel: UILabel?
    var denominatorLabel: UILabel?
    var networkLabel: UILabel?
    var networkCaptionLabel: UILabel?
    var performanceLabel: UILabel?
    var performanceCaptionLabel: UILabel?
    var slowFrameLabel: UILabel?
    var slowFrameCaptionLabel: UILabel?
    var dividerViews: [UIView] = []
    var ringLayer: CAShapeLayer?
    var stats = BubbleStats()
    var performanceStats = PerformanceFrameStats()
    var isDragging = false
    var idleWorkItem: DispatchWorkItem?
    var keyboardHeight: CGFloat = 0
    /// The bubble's Y origin just before `keyboardWillShow` clamps it above
    /// the keyboard. `nil` when the bubble wasn't clamped (keyboard didn't
    /// overlap it). Restored by `keyboardWillHide` so the bubble doesn't
    /// stay stuck at the clamped position after the keyboard dismisses.
    var preKeyboardOriginY: CGFloat?
    var savedPosition: CGPoint?
    var storeObserver: NSObjectProtocol?
    var pollTimer: Timer?
    var performance: HakkaPerformance?
    var performanceSubscription: SinkSubscription?
    var expansionState: ExpansionState = .collapsed
    var hudPanel: BubbleHudPanel?
    /// Tracks the dismiss-notification observer registered in `presentOverlay`
    /// (BubbleWindowGestures.swift); torn down there and in `cleanup()`.
    var dismissObserver: NSObjectProtocol?

    /// Tap toggles between these two; long-press always opens the full
    /// inspector regardless of which one is showing (see `applyExpansionState`).
    enum ExpansionState {
        case collapsed
        case expanded
    }

    private init() {}

    // MARK: - Public API

    public func show() {
        guard window == nil else { return }
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first
        else { return }

        let win = PassthroughWindow(windowScene: windowScene)
        win.windowLevel = .alert + 1
        win.backgroundColor = .clear
        win.rootViewController = UIViewController()
        win.rootViewController?.view.backgroundColor = .clear

        let bubble = makeBubbleView()
        win.rootViewController?.view.addSubview(bubble)
        win.bubbleView = bubble

        let screen = windowScene.screen.bounds
        let safeTop = windowScene.keyWindow?.safeAreaInsets.top ?? 44

        if let saved = savedPosition {
            bubble.frame = CGRect(origin: saved, size: CGSize(width: bubbleWidth, height: bubbleHeight))
        } else {
            let topY = safeTop + 68
            bubble.frame = CGRect(
                x: screen.width - bubbleWidth - edgeInset, y: topY,
                width: bubbleWidth, height: bubbleHeight
            )
        }

        self.window = win
        self.bubbleView = bubble
        win.makeKeyAndVisible()
        win.resignKey()

        // Materialize entrance.
        bubble.alpha = 0
        bubble.transform = CGAffineTransform(translationX: 18, y: -10).scaledBy(x: 0.88, y: 0.88)
        if let ev = effectView {
            ev.effect = nil
            UIView.animate(withDuration: 0.44, delay: 0, usingSpringWithDamping: 0.72, initialSpringVelocity: 0.65) {
                bubble.transform = .identity
                bubble.alpha = 1
            }
            UIView.animate(withDuration: 0.24) {
                ev.effect = self.makeGlassEffect()
            }
        } else {
            UIView.animate(withDuration: 0.44, delay: 0, usingSpringWithDamping: 0.72, initialSpringVelocity: 0.65) {
                bubble.transform = .identity
                bubble.alpha = 1
            }
        }

        syncStats()
        startPerformanceMetrics()
        observeStore()
        observeKeyboard()
        scheduleIdleFade()
    }

    public func hide() {
        removeObservers()
        idleWorkItem?.cancel()
        guard let bubble = bubbleView else { cleanup(); return }
        savedPosition = bubble.frame.origin

        if let ev = effectView {
            UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseIn]) {
                ev.effect = nil
                bubble.alpha = 0
                bubble.transform = CGAffineTransform(translationX: 18, y: -10).scaledBy(x: 0.88, y: 0.88)
            } completion: { _ in self.cleanup() }
        } else {
            UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseIn], animations: {
                bubble.alpha = 0
                bubble.transform = CGAffineTransform(translationX: 18, y: -10).scaledBy(x: 0.88, y: 0.88)
            }, completion: { _ in self.cleanup() })
        }
    }

    public var isVisible: Bool { window != nil }
    public func toggle() { isVisible ? hide() : show() }

    public func setHiddenForOverlay(_ hidden: Bool) {
        window?.isHidden = hidden
    }

    public func recordRequest(status: Int?) {
        stats.record(status: status)
        updateDisplay()
        wakeFromIdle()
    }

    public func resetStats() {
        stats = BubbleStats()
        performanceStats = PerformanceFrameStats()
        updateDisplay()
    }

    public func performanceSnapshot() -> HakkaUIPerformanceSnapshot {
        HakkaUIPerformanceSnapshot(
            fps: performanceStats.isFresh ? performanceStats.fps : nil,
            refreshRateHz: performanceStats.refreshRateHz,
            slowFrameRate: performanceStats.isFresh ? performanceStats.slowFrameRate : nil,
            frozenFrameCount: performanceStats.isFresh ? performanceStats.frozenFrameCount : 0,
            isFresh: performanceStats.isFresh
        )
    }

    // MARK: - Glass Effect

    func makeGlassEffect() -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect()
            glass.isInteractive = true
            return glass
        }
        return UIBlurEffect(style: .systemUltraThinMaterialDark)
    }

    // MARK: - Cleanup

    func cleanup() {
        removeObservers()
        stopPerformanceMetrics()
        if let obs = dismissObserver { NotificationCenter.default.removeObserver(obs); dismissObserver = nil }
        idleWorkItem?.cancel()
        bubbleView?.removeFromSuperview()
        bubbleView = nil; effectView = nil; numeratorLabel = nil
        denominatorLabel = nil; performanceLabel = nil; performanceCaptionLabel = nil
        slowFrameLabel = nil; slowFrameCaptionLabel = nil
        networkLabel = nil; networkCaptionLabel = nil; dividerViews = []
        ringLayer = nil
        expansionState = .collapsed
        hudPanel = nil
        // Otherwise a stale Y from a previous show/hide cycle's keyboard
        // clamp can restore a freshly re-shown bubbleView to the wrong spot.
        preKeyboardOriginY = nil
        window?.isHidden = true; window = nil
    }
}
#endif
