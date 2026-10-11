import Foundation
import HakkaCommon
import HakkaCore

/// Navigation scopes the shared buffer without changing capture or attribution.
extension TrafficModel {
    var domainCounts: [(domain: String, count: Int)] {
        Dictionary(grouping: requests, by: { TrafficQueryCompiler.requestHost($0).lowercased() })
            .map { (domain: $0.key, count: $0.value.count) }
            .sorted { $0.domain < $1.domain }
    }

    var sourceCounts: [(source: RequestSource, count: Int)] {
        Dictionary(grouping: requests, by: \.source)
            .map { (source: $0.key, count: $0.value.count) }
            .sorted { $0.source.displayName < $1.source.displayName }
    }

    func workspaceMatches(_ request: NetworkRequest) -> Bool {
        if let selectedDomain, TrafficQueryCompiler.requestHost(request).lowercased() != selectedDomain { return false }
        if let selectedSource, request.source != selectedSource { return false }
        return true
    }

    func resetWorkspaceFilters() {
        selectedDomain = nil
        selectedSource = nil
        searchText = ""
        errorsOnly = false
        noiseScope.clear()
    }
}
