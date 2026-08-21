import Foundation

/// Loads a pinned gRPC wire fixture from the repo-shared `fixtures/grpc/`
/// directory as base64 — the shape `GrpcBodyDecoder` expects, matching how
/// a binary body actually arrives in `NetworkRequest.responseBody`. See
/// `fixtures/grpc/README.md`.
enum GrpcFixtures {
    static func readBase64(_ name: String) throws -> String {
        // …/hakka/apps/hakka/Tests/CoreTests/GrpcFixtures.swift → repo root
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // CoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // hakka (the package)
            .deletingLastPathComponent() // apps
            .deletingLastPathComponent()
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("fixtures/grpc/\(name)"))
        return data.base64EncodedString()
    }
}
