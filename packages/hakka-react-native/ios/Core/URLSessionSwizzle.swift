// @generated — do not edit. Synced from ios/Sources/Network/URLSessionSwizzle.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

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
}
