import HakkaCommon
import HakkaCore

/// Layers `noiseScope` on top of `TrafficModel.searchMatchedRequests` — kept
/// out of the main file to hold the 200-line budget, and split out for the
/// same reason `TrafficModel+Session.swift` is: this is one coherent concern
/// (Focus/Noise filtering) that doesn't need to sit next to bridge wiring.
extension TrafficModel {
    /// The rows the list actually renders: search-matched, then with any
    /// noise-scope-muted host removed, then (if the toolbar's "Errors only"
    /// toggle is on) narrowed to rows carrying a severity — 4xx/5xx/transport
    /// failure, the same set the row stripe colors. `errorsOnly` composes on
    /// top of the other two rather than replacing either, so turning it back
    /// off hands back exactly what search and the noise scope were already
    /// showing. Built from `noiseScopedRequests` (not itself) so
    /// `hiddenByNoiseScopeCount` below stays accurate regardless of whether
    /// `errorsOnly` is on.
    var visibleRequests: [NetworkRequest] {
        guard errorsOnly else { return noiseScopedRequests }
        return noiseScopedRequests.filter(hasVisibleSeverity)
    }

    /// `searchMatchedRequests` with any noise-scope-muted host removed. A
    /// muted host is never dropped from `requests` itself — see
    /// `hiddenByNoiseScopeCount`/`hiddenNoiseScopeErrorCount` for what's
    /// still being tracked about it.
    private var noiseScopedRequests: [NetworkRequest] {
        guard noiseScope.isActive else { return searchMatchedRequests }
        return searchMatchedRequests.filter { !isHiddenByNoiseScope($0) }
    }

    /// How many currently search-matched rows the noise scope is hiding —
    /// backs the toolbar pill's count. Zero when no scope is active, not
    /// just when nothing happens to be muted right now. Measured against
    /// `noiseScopedRequests`, not `visibleRequests`, so toggling "Errors
    /// only" can never change this count out from under the pill.
    var hiddenByNoiseScopeCount: Int {
        guard noiseScope.isActive else { return 0 }
        return searchMatchedRequests.count - noiseScopedRequests.count
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

    /// The broader set the "Errors only" toggle keeps: any row carrying a
    /// severity at all — 5xx/transport failure *or* 4xx — matching what the
    /// row's stripe actually lights up for. Deliberately wider than
    /// `isErroring` above, which is scoped to just the 5xx/transport case for
    /// the noise-scope pill's specific "still 500ing while muted" question.
    private func hasVisibleSeverity(_ request: NetworkRequest) -> Bool {
        TrafficRowSeverity(status: request.status, transportError: request.error != nil) != nil
    }
}
