import Foundation
import HakkaCommon
import HakkaCore
import Observation

/// A persisted lens over the traffic list — the standing counterpart to
/// `FilterPresetStore`. A preset is a query you re-type by name; this is a
/// scope you leave on. Include rules narrow the list to matching hosts,
/// exclude rules mute a host from view *without* dropping it from capture
/// (captured-but-hidden rather than filtered-out). `TrafficModel` is the
/// thing that actually removes rows from `visibleRequests`; this type only
/// decides which host substrings are in or out of scope.
@MainActor @Observable
final class NoiseScopeStore {
    /// A reusable, named traffic lens. Domains are alternatives; a path and
    /// selected methods further narrow those domains. Noise rules are kept
    /// outside the set, so a chatty host stays muted when the user switches
    /// between investigations.
    struct FocusSet: Codable, Identifiable, Equatable, Hashable {
        let id: UUID
        let name: String
        let domains: [String]
        let pathPrefix: String
        let methods: [String]

        init(id: UUID = UUID(), name: String, domains: [String], pathPrefix: String = "", methods: [String] = []) {
            self.id = id
            self.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
            self.domains = domains.map {
                let domain = $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                return domain.hasPrefix(".") ? String(domain.dropFirst()) : domain
            }.filter { !$0.isEmpty }
            let trimmedPath = pathPrefix.trimmingCharacters(in: .whitespacesAndNewlines)
            self.pathPrefix = trimmedPath.isEmpty || trimmedPath.hasPrefix("/") ? trimmedPath : "/\(trimmedPath)"
            self.methods = methods.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }.filter { !$0.isEmpty }
        }

        var isUsable: Bool {
            !domains.isEmpty || !pathPrefix.isEmpty || !methods.isEmpty
        }

        var summary: String {
            var parts: [String] = []
            if !domains.isEmpty {
                parts.append(domains.joined(separator: ", "))
            }
            if !pathPrefix.isEmpty {
                parts.append(pathPrefix)
            }
            if !methods.isEmpty {
                parts.append(methods.joined(separator: ", "))
            }
            return parts.joined(separator: " · ")
        }

        func matches(_ request: NetworkRequest) -> Bool {
            let host = TrafficQueryCompiler.requestHost(request).lowercased()
            guard domains.isEmpty || domains.contains(where: { host == $0 || host.hasSuffix(".\($0)") }) else { return false }
            let path = URLComponents(string: request.url)?.path ?? request.url
            guard pathPrefix.isEmpty || path.hasPrefix(pathPrefix) else { return false }
            return methods.isEmpty || methods.contains(request.method.rawValue.uppercased())
        }
    }

    /// A substring match against a request's host (see
    /// `TrafficQueryCompiler.requestHost`). Lowercased at creation so every
    /// comparison downstream is a plain `contains`, not a re-lowercase per row.
    struct Rule: Codable, Identifiable, Equatable, Hashable {
        let id: UUID
        let host: String

        init(host: String) {
            id = UUID()
            self.host = host.lowercased()
        }
    }

    private(set) var includeRules: [Rule] = []
    private(set) var excludeRules: [Rule] = []
    private(set) var focusSets: [FocusSet] = []
    private(set) var activeFocusSetID: UUID?

    private let defaults: UserDefaults
    private let key = "hakka.traffic.noiseScope"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: key),
           let stored = try? JSONDecoder().decode(Persisted.self, from: data)
        {
            includeRules = stored.include
            excludeRules = stored.exclude
            focusSets = stored.focusSets
            activeFocusSetID = stored.activeFocusSetID
        }
    }

    private struct Persisted: Codable {
        var include: [Rule]
        var exclude: [Rule]
        var focusSets: [FocusSet]
        var activeFocusSetID: UUID?

        private enum CodingKeys: String, CodingKey { case include, exclude, focusSets, activeFocusSetID }

        init(include: [Rule], exclude: [Rule], focusSets: [FocusSet] = [], activeFocusSetID: UUID? = nil) {
            self.include = include
            self.exclude = exclude
            self.focusSets = focusSets
            self.activeFocusSetID = activeFocusSetID
        }

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            include = try values.decode([Rule].self, forKey: .include)
            exclude = try values.decode([Rule].self, forKey: .exclude)
            focusSets = try values.decodeIfPresent([FocusSet].self, forKey: .focusSets) ?? []
            activeFocusSetID = try values.decodeIfPresent(UUID.self, forKey: .activeFocusSetID)
        }
    }

    /// Whether any rule is set — the toolbar pill only renders when this is
    /// true, so an idle app pays no chrome cost for a feature it isn't using.
    var isActive: Bool {
        !includeRules.isEmpty || !excludeRules.isEmpty || activeFocusSet != nil
    }

    var activeFocusSet: FocusSet? {
        guard let activeFocusSetID else { return nil }
        return focusSets.first { $0.id == activeFocusSetID }
    }

    /// True when `host` should be hidden from `TrafficModel.visibleRequests`.
    /// Exclude always wins: a host on both lists is hidden, so muting a
    /// chatty domain can never be silently undone by an overlapping focus
    /// rule.
    func hides(host: String) -> Bool {
        let host = host.lowercased()
        if excludeRules.contains(where: { host.contains($0.host) }) {
            return true
        }
        if !includeRules.isEmpty, !includeRules.contains(where: { host.contains($0.host) }) {
            return true
        }
        return false
    }

    /// The request-aware form used by the traffic list. It preserves the
    /// old host-only rules for existing users, then applies the selected
    /// Focus Set's domain/path/method criteria.
    func hides(_ request: NetworkRequest) -> Bool {
        guard !hides(host: TrafficQueryCompiler.requestHost(request)) else { return true }
        return activeFocusSet.map { !$0.matches(request) } ?? false
    }

    /// Mutes a host from a row's context menu — the point where a developer
    /// actually notices the noise. A no-op if already muted.
    func mute(host: String) {
        let host = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !host.isEmpty else { return }
        guard !excludeRules.contains(where: { $0.host == host }) else { return }
        excludeRules.append(Rule(host: host))
        persist()
    }

    func unmute(_ rule: Rule) {
        excludeRules.removeAll { $0.id == rule.id }
        persist()
    }

    func focus(host: String) {
        let host = host.lowercased()
        guard !includeRules.contains(where: { $0.host == host }) else { return }
        includeRules.append(Rule(host: host))
        persist()
    }

    /// Saves by name, keeping a familiar Focus Set current instead of
    /// accumulating indistinguishable duplicates in the sidebar.
    @discardableResult
    func saveFocusSet(name: String, domains: [String], pathPrefix: String = "", methods: [String] = []) -> FocusSet? {
        let set = FocusSet(name: name, domains: domains, pathPrefix: pathPrefix, methods: methods)
        guard !set.name.isEmpty, set.isUsable else { return nil }
        let replacesActiveSet = focusSets.contains {
            $0.id == activeFocusSetID && $0.name.caseInsensitiveCompare(set.name) == .orderedSame
        }
        focusSets.removeAll { $0.name.caseInsensitiveCompare(set.name) == .orderedSame }
        focusSets.append(set)
        if replacesActiveSet {
            activeFocusSetID = set.id
        }
        persist()
        return set
    }

    func apply(_ focusSet: FocusSet?) {
        activeFocusSetID = focusSet?.id
        persist()
    }

    func delete(_ focusSet: FocusSet) {
        focusSets.removeAll { $0.id == focusSet.id }
        if activeFocusSetID == focusSet.id {
            activeFocusSetID = nil
        }
        persist()
    }

    /// Clears every rule in one gesture — backs the toolbar pill's clear
    /// affordance.
    func clear() {
        includeRules = []
        excludeRules = []
        activeFocusSetID = nil
        persist()
    }

    private func persist() {
        let payload = Persisted(include: includeRules, exclude: excludeRules, focusSets: focusSets, activeFocusSetID: activeFocusSetID)
        if let data = try? JSONEncoder().encode(payload) {
            defaults.set(data, forKey: key)
        }
    }
}
