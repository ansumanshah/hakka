import Foundation

// MARK: - URLSessionConfiguration Swizzling

extension URLSessionConfiguration {
    @objc dynamic class var hakka_defaultWithProtocol: URLSessionConfiguration {
        let config = self.hakka_defaultWithProtocol // calls original (swapped)
        config.injectHakkaProtocol()
        return config
    }

    @objc dynamic class var hakka_ephemeralWithProtocol: URLSessionConfiguration {
        let config = self.hakka_ephemeralWithProtocol // calls original (swapped)
        config.injectHakkaProtocol()
        return config
    }

    private func injectHakkaProtocol() {
        var protocols = self.protocolClasses ?? []
        if !protocols.contains(where: { $0 == HakkaURLProtocol.self }) {
            protocols.insert(HakkaURLProtocol.self, at: 0)
        }
        self.protocolClasses = protocols
    }

    // MARK: - Background session detection
    //
    // `.background(withIdentifier:)` does not get the `injectHakkaProtocol()`
    // treatment above: setting `protocolClasses` on a background configuration
    // is a documented no-op — its transfers run through Apple's out-of-process
    // `nsurlsessiond` daemon, which never consults it. Swizzling this factory
    // method still buys detection, so Hakka can report the gap instead of
    // silently missing the traffic. See `HakkaURLProtocol.reportBackgroundSessionDetected`.
    @objc dynamic class func hakka_backgroundWithIdentifierDetected(_ identifier: String) -> URLSessionConfiguration {
        let config = self.hakka_backgroundWithIdentifierDetected(identifier) // calls original (swapped)
        HakkaURLProtocol.reportBackgroundSessionDetected(identifier: identifier)
        return config
    }
}

// MARK: - Swizzle installation

extension HakkaURLProtocol {
    private static let backgroundSwizzleLock = NSLock()
    private nonisolated(unsafe) static var backgroundSwizzleInstalled = false

    /// Installs the `background(withIdentifier:)` detection swizzle exactly
    /// once per process. Triggered by the `interceptor` setter in
    /// `URLProtocol.swift` — the same place `HakkaInterceptor.start()` already
    /// wires up `.interceptor` before registering `HakkaURLProtocol` and
    /// swizzling `.default`/`.ephemeral` — so no separate call site is needed.
    /// Like that swizzle, this is never reverted on `stop()`: a later
    /// `start()` in the same process must not re-warn for sessions created
    /// while capture was stopped, and un-swizzling a live class method from
    /// underneath in-flight background sessions would be unsafe.
    static func installBackgroundSessionDetectionIfNeeded() {
        backgroundSwizzleLock.lock()
        defer { backgroundSwizzleLock.unlock() }
        guard !backgroundSwizzleInstalled else { return }
        backgroundSwizzleInstalled = true

        let swizzledSel = #selector(URLSessionConfiguration.hakka_backgroundWithIdentifierDetected(_:))
        let originalSel = #selector(URLSessionConfiguration.background(withIdentifier:))
        guard
            let original = class_getClassMethod(URLSessionConfiguration.self, originalSel),
            let swizzled = class_getClassMethod(URLSessionConfiguration.self, swizzledSel)
        else { return }
        method_exchangeImplementations(original, swizzled)
    }
}
