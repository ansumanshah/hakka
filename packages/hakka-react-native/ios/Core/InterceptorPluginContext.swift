// @generated — do not edit. Synced from ios/Sources/Network/InterceptorPluginContext.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation
#if canImport(HakkaCommon)
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#endif

// MARK: - InterceptorPluginContext

/// Concrete ``HakkaPluginContext`` backed by a ``HakkaInterceptor``.
///
/// Keeps a weak reference so the interceptor can be deallocated without
/// dangling plugin teardowns.
final class InterceptorPluginContext: HakkaPluginContext, @unchecked Sendable {
    private weak var interceptor: HakkaInterceptor?

    init(interceptor: HakkaInterceptor) {
        self.interceptor = interceptor
    }

    func ingest(_ request: NetworkRequest) {
        interceptor?.commitProcessedCapture(request)
    }

    @discardableResult
    func update(id: String, transform: @Sendable (inout NetworkRequest) -> Void) -> Bool {
        guard let store = interceptor?.store else { return false }
        return store.update(id: id, transform: transform)
    }

    func onRequest(_ listener: @escaping @Sendable (NetworkRequest) -> Void) -> HakkaPluginSubscription {
        guard let interceptor else {
            return HakkaPluginSubscription {}
        }
        let token = interceptor.addRequestListener(listener)
        return HakkaPluginSubscription {
            token.cancel()
        }
    }

    func getLogs() -> [NetworkRequest] {
        interceptor?.store.requests ?? []
    }

    func registerSink(_ sink: @escaping RecordSink) -> HakkaPluginSubscription {
        guard let interceptor else { return HakkaPluginSubscription {} }
        let sub = interceptor.addSink(sink)
        return HakkaPluginSubscription {
            sub.cancel()
        }
    }
}
