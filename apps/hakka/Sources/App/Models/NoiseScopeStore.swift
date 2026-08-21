import Foundation
import Observation

/// A persisted lens over the traffic list — the standing counterpart to
/// `FilterPresetStore`. A preset is a query you re-type by name; this is a
/// scope you leave on. Include rules narrow the list to matching hosts,
/// exclude rules mute a host from view *without* dropping it from capture
/// (the "Noise Control" idea from Rockxy's source digest, captured-but-hidden
/// rather than filtered-out). `TrafficModel` is the thing that actually
/// removes rows from `visibleRequests`; this type only decides which host
/// substrings are in or out of scope.
@MainActor @Observable
final class NoiseScopeStore {
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

    private let defaults: UserDefaults
    private let key = "hakka.traffic.noiseScope"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: key),
           let stored = try? JSONDecoder().decode(Persisted.self, from: data) {
            includeRules = stored.include
            excludeRules = stored.exclude
        }
    }

    private struct Persisted: Codable {
        var include: [Rule]
        var exclude: [Rule]
    }

    /// Whether any rule is set — the toolbar pill only renders when this is
    /// true, so an idle app pays no chrome cost for a feature it isn't using.
    var isActive: Bool { !includeRules.isEmpty || !excludeRules.isEmpty }

    /// True when `host` should be hidden from `TrafficModel.visibleRequests`.
    /// Exclude always wins: a host on both lists is hidden, so muting a
    /// chatty domain can never be silently undone by an overlapping focus
    /// rule — the same guarantee Rockxy's Noise Control makes.
    func hides(host: String) -> Bool {
        let host = host.lowercased()
        if excludeRules.contains(where: { host.contains($0.host) }) { return true }
        if !includeRules.isEmpty, !includeRules.contains(where: { host.contains($0.host) }) { return true }
        return false
    }

    /// Mutes a host from a row's context menu — the point where a developer
    /// actually notices the noise. A no-op if already muted.
    func mute(host: String) {
        let host = host.lowercased()
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

    func unfocus(_ rule: Rule) {
        includeRules.removeAll { $0.id == rule.id }
        persist()
    }

    /// Clears every rule in one gesture — backs the toolbar pill's clear
    /// affordance.
    func clear() {
        includeRules = []
        excludeRules = []
        persist()
    }

    private func persist() {
        let payload = Persisted(include: includeRules, exclude: excludeRules)
        if let data = try? JSONEncoder().encode(payload) {
            defaults.set(data, forKey: key)
        }
    }
}
