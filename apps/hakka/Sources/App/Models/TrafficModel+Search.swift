import HakkaCommon
import HakkaCore

/// Split out of `TrafficModel.swift` to hold the 200-line budget — this is
/// the search-DSL half of filtering (parse, compile, cache), a separate
/// concern from the noise-scope half in `TrafficModel+NoiseScope.swift`.
extension TrafficModel {
    /// `requests` filtered and sorted by `searchText`, newest first when the
    /// query names no sort of its own. Empty search returns the buffer
    /// unchanged, so the common case pays nothing. Does not apply the noise
    /// scope — see `TrafficModel+NoiseScope.swift`, which layers scope
    /// filtering (and its hidden-row tallies) on top of this set.
    var searchMatchedRequests: [NetworkRequest] {
        let trimmed = searchText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return requests.reversed() }

        let compiled = compiledQuery(for: trimmed)
        var matched = requests.filter(compiled.match)
        // `device:` has no reach into `TrafficQueryCompiler` — the compiler
        // works over a bare `NetworkRequest`, which carries no device
        // identity (see `DeviceLabelIndex`), so the model applies this term
        // itself using its own `deviceIndex`.
        if let device = compiled.query.device {
            matched = matched.filter { request in
                let matches = (deviceIndex[request.id] ?? "").lowercased().contains(device)
                return matches != compiled.query.deviceNegate
            }
        }
        guard let field = compiled.query.sort else { return matched.reversed() }
        return TrafficSort.sort(matched, field: field, order: compiled.query.order)
    }

    func compiledQuery(for text: String) -> (query: TrafficQuery, match: @Sendable (NetworkRequest) -> Bool) {
        if let cached = queryCache, cached.text == text { return (cached.query, cached.match) }
        let query = TrafficQueryParser.parse(text)
        let match = TrafficQueryCompiler.compile(query)
        queryCache = (text, query, match)
        return (query, match)
    }
}
