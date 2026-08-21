import HakkaCommon
import HakkaCore

/// Layers `noiseScope` on top of `TrafficModel.searchMatchedRequests` — kept
/// out of the main file to hold the 200-line budget, and split out for the
/// same reason `TrafficModel+Session.swift` is: this is one coherent concern
/// (Focus/Noise filtering) that doesn't need to sit next to bridge wiring.
extension TrafficModel {
    /// The rows the list actually renders: search-matched, then with any
    /// noise-scope-muted host removed. A muted host is never dropped from
    /// `requests` itself — see `hiddenByNoiseScopeCount`/
    /// `hiddenNoiseScopeErrorCount` for what's still being tracked about it.
    var visibleRequests: [NetworkRequest] {
        guard noiseScope.isActive else { return searchMatchedRequests }
        return searchMatchedRequests.filter { !isHiddenByNoiseScope($0) }
    }

    /// How many currently search-matched rows the noise scope is hiding —
    /// backs the toolbar pill's count. Zero when no scope is active, not
    /// just when nothing happens to be muted right now.
    var hiddenByNoiseScopeCount: Int {
        guard noiseScope.isActive else { return 0 }
        return searchMatchedRequests.count - visibleRequests.count
    }

    /// Of the rows the scope is hiding, how many are erroring right now —
    /// so a muted domain that starts 500ing can still say so without being
    /// unmuted first. This is the entire point of "hidden, not filtered".
    var hiddenNoiseScopeErrorCount: Int {
        guard noiseScope.isActive else { return 0 }
        return searchMatchedRequests.lazy
            .filter(isHiddenByNoiseScope)
            .filter(isErroring)
            .count
    }

    private func isHiddenByNoiseScope(_ request: NetworkRequest) -> Bool {
        noiseScope.hides(host: TrafficQueryCompiler.requestHost(request))
    }

    private func isErroring(_ request: NetworkRequest) -> Bool {
        TrafficRowSeverity(status: request.status, transportError: request.error != nil) == .error
    }
}
