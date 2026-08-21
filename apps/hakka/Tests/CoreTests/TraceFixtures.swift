import Foundation
import HakkaCommon
@testable import HakkaCore

/// Loads a pinned trace wire fixture from the repo-shared `fixtures/span/`
/// directory — see `fixtures/span/README.md`. Every field matches
/// `FrameworkSpan`/`NetworkRequest` in `packages/hakka-core/src/model/types.ts`
/// exactly, so these decode with the production `JSONDecoder`, not a
/// test-only shape.
enum TraceFixtures {
    private static func data(_ name: String) throws -> Data {
        // …/hakka/apps/hakka/Tests/CoreTests/TraceFixtures.swift → repo root
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // CoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // hakka (the package)
            .deletingLastPathComponent() // apps
            .deletingLastPathComponent()
        return try Data(contentsOf: repoRoot.appendingPathComponent("fixtures/span/\(name)"))
    }

    static func request(_ name: String) throws -> NetworkRequest {
        try JSONDecoder().decode(NetworkRequest.self, from: data(name))
    }

    static func span(_ name: String) throws -> FrameworkSpan {
        try JSONDecoder().decode(FrameworkSpan.self, from: data(name))
    }
}
