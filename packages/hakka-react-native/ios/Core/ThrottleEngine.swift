// @generated — do not edit. Synced from ios/Sources/Common/ThrottleEngine.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - ThrottleProfile

/// Network condition profiles matching `packages/hakka-core/src/engine/ThrottleEngine.ts`.
public enum ThrottleProfile: String, Sendable, CaseIterable {
    case none      = "none"
    case fast3g    = "fast-3g"
    case slow3g    = "slow-3g"
    case edge      = "edge"
    case offline   = "offline"
    /// Caller-supplied latency/bandwidth via `ThrottleEngine.setCustom(latencyMs:downloadKbps:)`.
    /// Matches `packages/hakka-core/src/engine/ThrottleEngine.ts`'s `'custom'` profile.
    case custom    = "custom"
}

// MARK: - ThrottleConfig

/// Active throttle configuration: a profile plus the resolved latency and bandwidth.
public struct ThrottleConfig: Sendable, Equatable {
    /// Selected profile.
    public let profile: ThrottleProfile
    /// Additional latency to inject before the request leaves the device (ms).
    public let latencyMs: Int
    /// Simulated downstream bandwidth (kbps). 0 = unlimited.
    public let downloadKbps: Int

    public init(profile: ThrottleProfile, latencyMs: Int, downloadKbps: Int) {
        self.profile = profile
        self.latencyMs = latencyMs
        self.downloadKbps = downloadKbps
    }
}

// MARK: - Preset table

/// Preset values matching the TS engine exactly:
/// offline: { latencyMs: 0,   downloadKbps: 0    }
/// slow-3g: { latencyMs: 400, downloadKbps: 400  }
/// fast-3g: { latencyMs: 150, downloadKbps: 1500 }
/// edge:    { latencyMs: 250, downloadKbps: 240  }
private let presets: [ThrottleProfile: (latencyMs: Int, downloadKbps: Int)] = [
    .offline: (0,    0),
    .slow3g:  (400,  400),
    .fast3g:  (150,  1500),
    .edge:    (250,  240),
]

/// The latency/bandwidth pair `setProfile(_:)` would resolve `profile` to —
/// exposed read-only so a caller that only wants to *display* a profile's
/// numbers (the desktop Rules surface's throttle readout) never has to go
/// through `setProfile`, which would mutate the shared engine's live config
/// as a side effect of rendering a label. `.none` (zero-overhead default)
/// and `.custom` (caller-supplied, no fixed pair) have no preset entry —
/// `nil` for both, same as `presets[profile]` itself.
public func throttlePresetValues(for profile: ThrottleProfile) -> (latencyMs: Int, downloadKbps: Int)? {
    presets[profile]
}

// MARK: - ThrottleEngine

/// Thread-safe throttle engine. Singleton used by `HakkaURLProtocol`.
///
/// Off by default: `profile == .none` → zero overhead on the hot path.
/// Preset numbers: `throttlePresetValues(for:)` above.
///
/// ## Integration
/// `HakkaURLProtocol` calls:
/// 1. `applyLatency()` on a background thread **before** `issueDataTask` — adds the
///    per-profile latency sleep.
/// 2. `drip(data:client:)` in `didReceive data:` — paces byte delivery to the client
///    at `downloadKbps` on a background queue; never touches the main thread.
/// 3. `isOffline` in `startLoading` — fail the request immediately with a network error.
public final class ThrottleEngine: @unchecked Sendable {

    /// Shared singleton used by `HakkaURLProtocol`.
    public static let shared = ThrottleEngine()

    // MARK: - Private state

    private let lock = NSLock()
    private var _config: ThrottleConfig = ThrottleConfig(profile: .none, latencyMs: 0, downloadKbps: 0)
    private var listeners: [String: () -> Void] = [:]

    public init() {}

    // MARK: - Public accessors

    /// Current throttle configuration.
    public var config: ThrottleConfig {
        lock.lock()
        defer { lock.unlock() }
        return _config
    }

    /// `true` when any throttle is active (i.e. profile is not `.none`).
    public var isActive: Bool { config.profile != .none }

    /// `true` when the offline profile is selected — requests should be dropped.
    public var isOffline: Bool { config.profile == .offline }

    // MARK: - Profile selection

    /// Select a preset profile. Resolves latency and bandwidth from the preset table.
    /// Setting `.none` resets to zero overhead.
    public func setProfile(_ profile: ThrottleProfile) {
        let cfg: ThrottleConfig
        if profile == .none {
            cfg = ThrottleConfig(profile: .none, latencyMs: 0, downloadKbps: 0)
        } else if profile == .custom {
            // Matches TS: selecting `.custom` via setProfile (no explicit values)
            // keeps the previously-configured latency/bandwidth, only flipping
            // the profile tag. Use `setCustom(latencyMs:downloadKbps:)` to set values.
            lock.lock()
            let existing = _config
            lock.unlock()
            cfg = ThrottleConfig(profile: .custom, latencyMs: existing.latencyMs, downloadKbps: existing.downloadKbps)
        } else if let preset = presets[profile] {
            cfg = ThrottleConfig(profile: profile, latencyMs: preset.latencyMs, downloadKbps: preset.downloadKbps)
        } else {
            // offline has no preset entry above; explicit zero values are correct.
            cfg = ThrottleConfig(profile: profile, latencyMs: 0, downloadKbps: 0)
        }
        lock.lock()
        _config = cfg
        let snapshot = Array(listeners.values)
        lock.unlock()
        DispatchQueue.main.async { for l in snapshot { l() } }
    }

    /// Set an explicit custom latency/bandwidth profile. Matches TS
    /// `ThrottleEngine.setCustom(latencyMs, downloadKbps?)`.
    public func setCustom(latencyMs: Int, downloadKbps: Int = 0) {
        let cfg = ThrottleConfig(profile: .custom, latencyMs: max(0, latencyMs), downloadKbps: max(0, downloadKbps))
        lock.lock()
        _config = cfg
        let snapshot = Array(listeners.values)
        lock.unlock()
        DispatchQueue.main.async { for l in snapshot { l() } }
    }

    // MARK: - Network simulation helpers

    /// Block the calling background thread for `latencyMs` milliseconds.
    /// No-op when `profile == .none` or `latencyMs == 0`.
    /// Must be called from a **background** thread (never main).
    public func applyLatency() {
        let ms = config.latencyMs
        guard ms > 0 else { return }
        Thread.sleep(forTimeInterval: Double(ms) / 1_000.0)
    }

    /// Compute how many milliseconds to wait before delivering `byteCount` bytes
    /// at the profile's `downloadKbps` bandwidth.
    ///
    /// Formula (matching TS `throttleResponse`):
    ///   bytesPerMs = (kbps × 1024) / 8 / 1000
    ///   delayMs    = byteCount / bytesPerMs
    ///
    /// Returns 0 when `downloadKbps` is 0 (unlimited) or `byteCount` is 0.
    public func delayForBytes(_ byteCount: Int) -> TimeInterval {
        let kbps = config.downloadKbps
        guard kbps > 0, byteCount > 0 else { return 0 }
        let bytesPerMs: Double = (Double(kbps) * 1024.0) / 8.0 / 1000.0
        return Double(byteCount) / bytesPerMs / 1_000.0  // result in seconds for Thread.sleep
    }

    /// Chunk size for drip delivery, matching the TS implementation (~1 KB).
    public static let dripChunkSize: Int = 1024

    // MARK: - Observation

    /// Subscribe to profile changes. Returns an unsubscribe closure.
    @discardableResult
    public func subscribe(_ listener: @escaping () -> Void) -> () -> Void {
        lock.lock()
        let token = UUID().uuidString
        listeners[token] = listener
        lock.unlock()
        return { [weak self] in
            self?.lock.lock()
            self?.listeners.removeValue(forKey: token)
            self?.lock.unlock()
        }
    }
}

// MARK: - delayForBytes (ms) convenience for tests

extension ThrottleEngine {
    /// Same as `delayForBytes(_:)` but returns milliseconds (Double) for easier
    /// test assertion without floating-point seconds conversion.
    public func delayForBytesMs(_ byteCount: Int) -> Double {
        let kbps = config.downloadKbps
        guard kbps > 0, byteCount > 0 else { return 0 }
        let bytesPerMs: Double = (Double(kbps) * 1024.0) / 8.0 / 1000.0
        return Double(byteCount) / bytesPerMs
    }
}
