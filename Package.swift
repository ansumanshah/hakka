// swift-tools-version: 6.0

// Repository-root manifest so Swift Package Manager can consume Hakka by URL
// (`.package(url: "https://github.com/ansumanshah/hakka", from: "0.1.1")`).
// It exposes the same products as `ios/Package.swift`, which remains the
// development manifest with the test targets.

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
            path: "ios/Sources/Common"
        ),
        .target(
            name: "HakkaNetwork",
            dependencies: ["HakkaCommon"],
            path: "ios/Sources/Network"
        ),
        .target(
            name: "HakkaPerformance",
            dependencies: ["HakkaCommon"],
            path: "ios/Sources/Performance"
        ),
        .target(
            name: "HakkaNetworkNoop",
            dependencies: ["HakkaCommon"],
            path: "ios/Sources/NetworkNoop"
        ),
        .target(
            name: "HakkaPerformanceNoop",
            dependencies: ["HakkaCommon"],
            path: "ios/Sources/PerformanceNoop"
        ),
        .target(
            name: "HakkaUI",
            dependencies: ["HakkaCommon", "HakkaNetwork", "HakkaPerformance"],
            path: "ios/Sources/UI"
        ),
    ]
)
