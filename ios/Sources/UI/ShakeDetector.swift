import Foundation
#if canImport(UIKit)
import UIKit
#endif
#if os(iOS)
import CoreMotion
#endif

/// Detects shake gestures on iOS using CoreMotion accelerometer.
///
/// Triggers callback when shake threshold is exceeded.
/// Use via HakkaUI's UIWindow extension, or directly:
/// ```swift
/// let detector = HakkaShakeDetector { OverlayWindow.shared.toggle() }
/// detector.start()
/// ```
#if os(iOS)
@MainActor
public class HakkaShakeDetector {

    private let motionManager: CMMotionManager
    private let onShake: @MainActor () -> Void

    /// Threshold for shake detection (higher = more force needed).
    private let shakeThreshold: Double = 2.5
    /// Minimum time between shakes (seconds).
    private let shakeCooldown: TimeInterval = 0.5
    /// Number of shake events required to trigger.
    private let shakeCountThreshold = 2

    private var lastShakeTime: Date = Date.distantPast
    private var shakeCount = 0

    public init(onShake: @escaping @MainActor () -> Void) {
        self.motionManager = CMMotionManager()
        self.onShake = onShake
    }

    /// Start listening for shake gestures.
    public func start() {
        guard motionManager.isAccelerometerAvailable else {
            print("HakkaShakeDetector: Accelerometer not available")
            return
        }

        motionManager.accelerometerUpdateInterval = 0.1

        motionManager.startAccelerometerUpdates(to: .main) { [weak self] (data, error) in
            guard let self = self, let accelerometerData = data else { return }
            self.processAccelerometerData(accelerometerData)
        }
    }

    /// Stop listening for shake gestures.
    public func stop() {
        motionManager.stopAccelerometerUpdates()
        shakeCount = 0
    }

    private func processAccelerometerData(_ data: CMAccelerometerData) {
        let acceleration = data.acceleration
        let totalAcceleration = sqrt(
            acceleration.x * acceleration.x +
            acceleration.y * acceleration.y +
            acceleration.z * acceleration.z
        )
        let deviceAcceleration = abs(totalAcceleration - 1.0)

        if deviceAcceleration > shakeThreshold {
            let now = Date()
            if now.timeIntervalSince(lastShakeTime) < shakeCooldown { return }

            shakeCount += 1
            lastShakeTime = now

            if shakeCount >= shakeCountThreshold {
                shakeCount = 0
                onShake()
            }
        }
    }

    nonisolated deinit {
        // CMMotionManager cleanup handled by ARC
    }
}
#endif // os(iOS)
