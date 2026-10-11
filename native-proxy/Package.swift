// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "HakkaNativeProxy",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "HakkaProxyEngine", targets: ["HakkaProxyEngine"]),
        .executable(name: "hakka-native-proxy", targets: ["HakkaNativeProxy"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-nio.git", exact: "2.103.0"),
        .package(url: "https://github.com/apple/swift-nio-ssl.git", exact: "2.37.5"),
    ],
    targets: [
        .target(name: "HakkaProxyEngine", dependencies: [
            .product(name: "NIOCore", package: "swift-nio"),
            .product(name: "NIOPosix", package: "swift-nio"),
            .product(name: "NIOHTTP1", package: "swift-nio"),
            .product(name: "NIOSSL", package: "swift-nio-ssl"),
        ]),
        .executableTarget(name: "HakkaNativeProxy", dependencies: ["HakkaProxyEngine"]),
        .testTarget(name: "HakkaProxyEngineTests", dependencies: ["HakkaProxyEngine"]),
    ]
)
