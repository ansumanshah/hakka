// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Hakka",
    platforms: [
        .iOS(.v16),
        .macOS(.v14),
        .tvOS(.v16),
        .watchOS(.v9),
    ],
    products: [
        .library(name: "HakkaCommon", targets: ["HakkaCommon"]),
        .library(name: "HakkaNetwork", targets: ["HakkaNetwork"]),
        .library(name: "HakkaPerformance", targets: ["HakkaPerformance"]),
        .library(name: "HakkaUI", targets: ["HakkaUI"]),
        .library(name: "HakkaNetworkNoop", targets: ["HakkaNetworkNoop"]),
        .library(name: "HakkaPerformanceNoop", targets: ["HakkaPerformanceNoop"]),
    ],
    targets: [
        .target(
            name: "HakkaCommon",
            path: "Sources/Common"
        ),
        .target(
            name: "HakkaNetwork",
            dependencies: ["HakkaCommon"],
            path: "Sources/Network"
        ),
        .target(
            name: "HakkaPerformance",
            dependencies: ["HakkaCommon"],
            path: "Sources/Performance"
        ),
        .target(
            name: "HakkaNetworkNoop",
            dependencies: ["HakkaCommon"],
            path: "Sources/NetworkNoop"
        ),
        .target(
            name: "HakkaPerformanceNoop",
            dependencies: ["HakkaCommon"],
            path: "Sources/PerformanceNoop"
        ),
        .target(
            name: "HakkaUI",
            dependencies: ["HakkaCommon", "HakkaNetwork", "HakkaPerformance"],
            path: "Sources/UI"
        ),
        .testTarget(
            name: "HakkaTests",
            dependencies: ["HakkaNetwork", "HakkaPerformance"],
            path: "Tests/HakkaTests"
        ),
        .testTarget(
            name: "HakkaNoopTests",
            dependencies: ["HakkaNetworkNoop", "HakkaPerformanceNoop"],
            path: "Tests/HakkaNoopTests"
        ),
    ]
)
