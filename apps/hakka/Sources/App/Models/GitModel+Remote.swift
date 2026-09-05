import Foundation
import HakkaCore

extension GitModel {
    private static let defaultRemote = "origin"

    func pull() {
        guard pullTask == nil, let repository, isRepository else { return }
        let binding = bindingID
        pullTask = Task {
            defer { if bindingID == binding { pullTask = nil } }
            do {
                try await repository.pull(remote: Self.defaultRemote)
                guard bindingID == binding, !Task.isCancelled else { return }
                lastError = nil
                await refresh()
            } catch is CancellationError {
            } catch GitError.cancelled {
            } catch {
                guard bindingID == binding, !Task.isCancelled else { return }
                lastError = Self.message(for: error)
            }
        }
    }

    func cancelPull() {
        pullTask?.cancel()
    }

    func push() {
        guard pushTask == nil, let repository, isRepository else { return }
        let binding = bindingID
        pushTask = Task {
            defer { if bindingID == binding { pushTask = nil } }
            do {
                try await repository.push(remote: Self.defaultRemote)
                guard bindingID == binding, !Task.isCancelled else { return }
                lastError = nil
                await refresh()
            } catch is CancellationError {
            } catch GitError.cancelled {
            } catch {
                guard bindingID == binding, !Task.isCancelled else { return }
                lastError = Self.message(for: error)
            }
        }
    }

    func cancelPush() {
        pushTask?.cancel()
    }
}
