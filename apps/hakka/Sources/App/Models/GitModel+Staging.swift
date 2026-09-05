import Foundation

extension GitModel {
    func stage(_ paths: [String]) async {
        guard let repository, isRepository, !paths.isEmpty else { return }
        let binding = bindingID
        do {
            try await repository.stage(paths: paths)
            guard bindingID == binding else { return }
            lastError = nil
            await refresh()
        } catch {
            guard bindingID == binding else { return }
            lastError = Self.message(for: error)
        }
    }

    func unstage(_ paths: [String]) async {
        guard let repository, isRepository, !paths.isEmpty else { return }
        let binding = bindingID
        do {
            try await repository.unstage(paths: paths)
            guard bindingID == binding else { return }
            lastError = nil
            await refresh()
        } catch {
            guard bindingID == binding else { return }
            lastError = Self.message(for: error)
        }
    }

    @discardableResult
    func commit(message: String) async -> Bool {
        guard let repository, isRepository else { return false }
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let binding = bindingID
        isCommitting = true
        defer { if bindingID == binding { isCommitting = false } }
        do {
            try await repository.commit(message: trimmed)
            guard bindingID == binding else { return false }
            lastError = nil
            await refresh()
            return bindingID == binding
        } catch {
            guard bindingID == binding else { return false }
            lastError = Self.message(for: error)
            return false
        }
    }
}
