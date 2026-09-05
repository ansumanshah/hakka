// @generated — do not edit. Synced from ios/Sources/UI/Overlay/ShakeWindow.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if os(iOS)
import Foundation
import UIKit
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif

// MARK: - UIWindow Shake Detection

/// Subclass that intercepts motionEnded(.motionShake) for Cmd+Ctrl+Z simulator support.
/// CoreMotion accelerometer (HakkaShakeDetector) handles real device shake.
class ShakeWindow: UIWindow {
    var onShake: (@MainActor () -> Void)?

    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        super.motionEnded(motion, with: event)
        if motion == .motionShake {
            onShake?()
        }
    }
}

// MARK: - UIWindow Extension

public extension UIWindow {

    private static var hakkaShakeDetectorKey: UInt8 = 0

    private var hakkaShakeDetector: HakkaShakeDetector? {
        get { objc_getAssociatedObject(self, &UIWindow.hakkaShakeDetectorKey) as? HakkaShakeDetector }
        set { objc_setAssociatedObject(self, &UIWindow.hakkaShakeDetectorKey, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC) }
    }

    /// Enable shake-to-open on this window with a custom handler.
    /// Uses CoreMotion on device + motionEnded fallback for Simulator (Cmd+Ctrl+Z).
    func enableHakkaShakeDetection(onShake: @escaping @MainActor () -> Void) {
        hakkaShakeDetector = HakkaShakeDetector(onShake: onShake)
        hakkaShakeDetector?.start()

        // Also wire up motionEnded for Simulator support
        if let shakeWindow = self as? ShakeWindow {
            shakeWindow.onShake = onShake
        }
    }

    /// Enable shake-to-open that toggles the floating bubble.
    /// If the bubble is hidden, shows it. If already visible, opens the inspector sheet.
    func enableHakkaShakeDetection() {
        enableHakkaShakeDetection {
            if BubbleWindow.shared.isVisible {
                OverlayWindow.shared.toggle()
            } else {
                BubbleWindow.shared.show()
            }
        }
    }

    /// Disable shake detection on this window.
    func disableHakkaShakeDetection() {
        hakkaShakeDetector?.stop()
        hakkaShakeDetector = nil
        (self as? ShakeWindow)?.onShake = nil
    }
}
#endif // os(iOS)
