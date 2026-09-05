import Foundation
import HakkaCore
import Observation

/// Git state belongs to the currently bound collection directory.
@MainActor
@Observable
final class GitModel {
    private(set) var directoryURL: URL?
    private(set) var isRepository = false
    private(set) var status: GitStatus?
    private(set) var currentBranch: String?
    private(set) var branches: [String] = []

    var lastError: String?

    private(set) var isRefreshing = false
    private(set) var isInitializing = false
    var isCommitting = false

    var pullTask: Task<Void, Never>?
    var pushTask: Task<Void, Never>?
    var isPulling: Bool { pullTask != nil }
    var isPushing: Bool { pushTask != nil }

    private(set) var bindingID = UUID()
    private var refreshID = UUID()

    private let runner: any GitRunning
    private(set) var repository: GitRepository?

    init(runner: any GitRunning = ProcessGitRunner()) {
        self.runner = runner
    }

    func bind(to directoryURL: URL?) async {
        bindingID = UUID()
        isRefreshing = false
        isInitializing = false
        isCommitting = false
        pullTask?.cancel()
        pullTask = nil
        pushTask?.cancel()
        pushTask = nil
        self.directoryURL = directoryURL
        lastError = nil
        status = nil
        currentBranch = nil
        branches = []
        guard let directoryURL else {
            isRepository = false
            repository = nil
            return
        }
        repository = GitRepository(directory: directoryURL, runner: runner)
        isRepository = GitRepository.isRepository(at: directoryURL)
        guard isRepository else { return }
        await refresh()
    }

    func initializeRepository() async {
        guard let repository, !isRepository else { return }
        let binding = bindingID
        isInitializing = true
        defer { if bindingID == binding { isInitializing = false } }
        do {
            try await repository.initializeRepository()
            guard bindingID == binding else { return }
            isRepository = true
            lastError = nil
            await refresh()
        } catch {
            guard bindingID == binding else { return }
            lastError = Self.message(for: error)
        }
    }

    func refresh() async {
        guard let repository, isRepository else { return }
        let binding = bindingID
        let request = UUID()
        refreshID = request
        isRefreshing = true
        defer {
            if bindingID == binding, refreshID == request { isRefreshing = false }
        }
        do {
            let newStatus = try await repository.status()
            let newBranch = try await repository.currentBranch()
            let newBranches = try await repository.listBranches()
            guard bindingID == binding, refreshID == request, !Task.isCancelled else { return }
            status = newStatus
            currentBranch = newBranch
            branches = newBranches
            lastError = nil
        } catch {
            guard bindingID == binding, refreshID == request, !Task.isCancelled else { return }
            lastError = Self.message(for: error)
        }
    }

    static func message(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
