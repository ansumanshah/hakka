import Foundation
import HakkaCore
import Observation

/// Environments plus the runtime values a run's `ResponseCapture`s have fed
/// back — the two layers `VariableScope` needs above collection defaults
/// (which this app does not yet model; see `CollectionModel`'s notes).
@MainActor
@Observable
final class EnvironmentModel {
    private(set) var environments: [RequestEnvironment] = []
    var selectedID: String?
    private(set) var runtime: [String: String] = [:]
    var lastError: String?

    private let store = EnvironmentStore()

    var selected: RequestEnvironment? {
        environments.first { $0.id == selectedID }
    }

    var scope: VariableScope {
        let values = Dictionary(
            uniqueKeysWithValues: (selected?.variables ?? []).filter(\.enabled).map { ($0.name, $0.value) }
        )
        return VariableScope(environment: values, runtime: runtime)
    }

    func load(forCollectionAt collectionDirectory: URL) async {
        do {
            environments = try await store.load(forCollectionAt: collectionDirectory)
            if selectedID == nil || !environments.contains(where: { $0.id == selectedID }) {
                selectedID = environments.first?.id
            }
            lastError = nil
        } catch {
            lastError = "Couldn't load environments: \(error.localizedDescription)"
        }
    }

    func save(forCollectionAt collectionDirectory: URL) async {
        do {
            try await store.save(environments, forCollectionAt: collectionDirectory)
            lastError = nil
        } catch {
            lastError = "Couldn't save environments: \(error.localizedDescription)"
        }
    }

    func addEnvironment(named name: String = "New Environment") {
        let environment = RequestEnvironment(name: name)
        environments.append(environment)
        selectedID = environment.id
    }

    func update(_ environment: RequestEnvironment) {
        guard let index = environments.firstIndex(where: { $0.id == environment.id }) else { return }
        environments[index] = environment
    }

    /// Folds a run's captured variables into `runtime` so the next request in
    /// the same session sees them — mirrors `VariableScope`'s own
    /// runtime-wins precedence.
    func adoptRuntime(from scope: VariableScope) {
        runtime = scope.runtime
    }
}
