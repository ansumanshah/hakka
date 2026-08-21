// swift-tools-version: 6.0
import PackageDescription

/// Injectable dylib that puts Hakka's existing SDK inside a simulator process
/// it was not built with — see `.claude/strategy/simulator-capture-2026-08.md`.
///
/// Kept as its own package (not folded into `../Package.swift`) so the
/// dynamic-library product doesn't change linkage for HakkaNetwork/HakkaCommon
/// consumers elsewhere (RN bridge, the macOS app). Depends on `../ios` by
/// path, same pattern as `apps/hakka` — one shared `HakkaInterceptor`,
/// `HakkaBridgeClient`, and wire protocol, no forked capture code.
let package = Package(
    name: "HakkaSimInject",
    platforms: [.iOS(.v16), .macOS(.v14)],
    products: [
        // Both targets ship in the same dylib: HakkaSimInjectC supplies the
        // dyld constructor (Swift cannot define one, see SimInjectBootstrap.swift),
        // HakkaSimInject is the actual bootstrap + capture logic it calls into.
        .library(name: "HakkaSimInject", type: .dynamic, targets: ["HakkaSimInjectC", "HakkaSimInject"]),
    ],
    dependencies: [
        .package(path: ".."),
    ],
    targets: [
        .target(
            name: "HakkaSimInject",
            dependencies: [
                .product(name: "HakkaCommon", package: "ios"),
                .product(name: "HakkaNetwork", package: "ios"),
            ],
            path: "Sources/HakkaSimInject"
        ),
        .target(
            name: "HakkaSimInjectC",
            dependencies: ["HakkaSimInject"],
            path: "Sources/HakkaSimInjectC"
        ),
        .testTarget(
            name: "HakkaSimInjectTests",
            dependencies: ["HakkaSimInject"],
            path: "Tests/HakkaSimInjectTests"
        ),
    ]
)
