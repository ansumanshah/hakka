import Foundation
import Testing
@testable import HakkaCore

@Suite("Git literal filesystem paths", .enabled(if: GitTestEnvironment.gitIsAvailable))
struct GitPathTests {
    @Test(arguments: ["*.txt", ":(glob)*.txt", "café.json", "line\nbreak.txt", "quote\"name.txt", "tab\tname.txt"])
    func stageUnstageAndDiffOnlyASelectedLiteralPath(fileName: String) async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            try GitTestRepository.write("selected\n", to: fileName, in: directory)
            try GitTestRepository.write("unrelated\n", to: "secret.txt", in: directory)
            let initial = try await repository.status()
            let selected = try #require(initial.untracked.first { $0.path == fileName })
            try await repository.stage(paths: [selected.path])
            #expect(try await repository.status().staged.map(\.path) == [fileName])
            try await repository.unstage(paths: [selected.path])
            #expect(try await repository.status().staged.isEmpty)

            try await repository.stage(paths: [fileName, "secret.txt"])
            try await repository.commit(message: "initial")
            try GitTestRepository.write("selected update\n", to: fileName, in: directory)
            try GitTestRepository.write("unrelated confidential update\n", to: "secret.txt", in: directory)
            let diff = try await repository.diff(path: selected.path)
            #expect(diff.contains("selected update"))
            #expect(!diff.contains("unrelated confidential update"))
            try await repository.stage(paths: [fileName, "secret.txt"])
            let stagedDiff = try await repository.stagedDiff(path: selected.path)
            #expect(stagedDiff.contains("selected update"))
            #expect(!stagedDiff.contains("unrelated confidential update"))
            try await repository.unstage(paths: [selected.path])
            let final = try await repository.status()
            #expect(final.staged.map(\.path) == ["secret.txt"])
            #expect(final.unstaged.map(\.path) == [fileName])
        }
    }

    @Test func renamedPathsPreserveUnicodeWhitespaceAndQuotes() async throws {
        try await GitTestRepository.withFreshRepository { repository, directory in
            let old = "old café\n\".txt"
            let new = "new café\t\".txt"
            try GitTestRepository.write("unchanged contents\n", to: old, in: directory)
            try await repository.stage(paths: [old])
            try await repository.commit(message: "initial")
            try FileManager.default.moveItem(at: directory.appendingPathComponent(old), to: directory.appendingPathComponent(new))
            try await repository.stage(paths: [old, new])
            let status = try await repository.status()
            let renamed = try #require(status.staged.first)
            #expect(renamed.path == new)
            #expect(renamed.originalPath == old)
            #expect(status.entries.count == 1)
        }
    }
}
