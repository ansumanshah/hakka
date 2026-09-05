import Foundation

extension GitModel {
    @discardableResult
    func createBranch(named name: String) async -> Bool {
        guard let repository, isRepository else { return false }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let binding = bindingID
        do {
            try await repository.createBranch(named: trimmed)
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

    func checkout(branch: String) async {
        guard let repository, isRepository else { return }
        let binding = bindingID
        do {
            try await repository.checkout(branch: branch)
            guard bindingID == binding else { return }
            lastError = nil
            await refresh()
        } catch {
            guard bindingID == binding else { return }
            lastError = Self.message(for: error)
        }
    }

    func createAndCheckout(branch name: String) async {
        guard await createBranch(named: name) else { return }
        await checkout(branch: name)
    }
}
