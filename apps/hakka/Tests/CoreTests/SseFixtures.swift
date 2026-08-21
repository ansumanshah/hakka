import Foundation

/// Loads a pinned SSE wire fixture from the repo-shared `fixtures/sse/`
/// directory — the same transcripts the TypeScript presenter tests assert
/// against, so the two surfaces cannot drift apart.
enum SseFixtures {
    static func read(_ name: String) throws -> String {
        // …/hakka/apps/hakka/Tests/CoreTests/SseFixtures.swift → repo root
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // CoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // hakka (the package)
            .deletingLastPathComponent() // apps
            .deletingLastPathComponent()
        return try String(contentsOf: repoRoot.appendingPathComponent("fixtures/sse/\(name)"), encoding: .utf8)
    }
}
