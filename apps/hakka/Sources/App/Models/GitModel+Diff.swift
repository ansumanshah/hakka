import Foundation
import HakkaCore

/// The same path can have distinct staged and working-tree changes.
struct GitDiffSelection: Equatable {
    let entry: GitStatusEntry
    let fromStagedSection: Bool
}

extension GitModel {
    func diff(for selection: GitDiffSelection) async -> String? {
        guard let repository, isRepository else { return nil }
        let entry = selection.entry
        if entry.isUntracked {
            return rawContents(atRelativePath: entry.path)
        }
        let binding = bindingID
        do {
            let text = selection.fromStagedSection
                ? try await repository.stagedDiff(path: entry.path)
                : try await repository.diff(path: entry.path)
            guard bindingID == binding, !Task.isCancelled else { return nil }
            lastError = nil
            return text
        } catch {
            guard bindingID == binding, !Task.isCancelled else { return nil }
            lastError = Self.message(for: error)
            return nil
        }
    }

    private func rawContents(atRelativePath path: String) -> String? {
        guard let directoryURL else { return nil }
        let fileURL = directoryURL.appendingPathComponent(path)
        guard let handle = try? FileHandle(forReadingFrom: fileURL) else { return nil }
        defer { try? handle.close() }
        do {
            let data = try handle.read(upToCount: 512_000) ?? Data()
            return String(data: data, encoding: .utf8) ?? "(binary file, not shown)"
        } catch {
            lastError = Self.message(for: error)
            return nil
        }
    }
}
