import Foundation

/// Loads a pinned control-channel wire fixture from the repo-shared
/// `fixtures/control/` directory — the same JSON the TypeScript and Kotlin
/// parser tests assert against, so the three runtimes cannot drift apart on
/// the `breakpoint.paused` / `.resume` / `.abort` shapes. See
/// `fixtures/control/README.md`.
enum ControlFixtures {
    static func read(_ name: String) throws -> Data {
        // …/hakka/ios/Tests/HakkaTests/ControlFixtures.swift → repo root
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // ControlFixtures.swift -> HakkaTests
            .deletingLastPathComponent() // HakkaTests -> Tests
            .deletingLastPathComponent() // Tests -> ios
            .deletingLastPathComponent() // ios -> repo root
        return try Data(contentsOf: repoRoot.appendingPathComponent("fixtures/control/\(name)"))
    }

    static func readJSON(_ name: String) throws -> [String: Any] {
        let data = try read(name)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            struct NotAnObject: Error {}
            throw NotAnObject()
        }
        return obj
    }
}
