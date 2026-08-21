// swift-tools-version: 6.0
import PackageDescription

/// Hakka for macOS — a native desktop inspector and API client.
///
/// Plugin-first by design (see `docs/.../adr/0008-desktop-plugin-products.md`):
/// the shippable units are SPM *products*, not an app. `HakkaCore` is
/// pure model/state with no UI and no server; `HakkaServer` is the
/// bridge hub actor; the executable is a thin host. Other Swift apps (Noodle,
/// Ramen) can depend on the products without inheriting the app shell.
///
/// The upstream `../../ios` package is consumed by path: HakkaCommon carries
/// the record contract, engines, and export writers that the desktop app must
/// agree with byte-for-byte, and HakkaUI carries the inspector views. Sharing
/// the source is the whole point — a fork would drift the moment a bug is
/// fixed on one side only.
let package = Package(
    name: "HakkaApp",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "HakkaCore", targets: ["HakkaCore"]),
        .library(name: "HakkaServer", targets: ["HakkaServer"]),
        .executable(name: "Hakka", targets: ["HakkaApp"]),
    ],
    dependencies: [
        .package(path: "../../ios"),
    ],
    targets: [
        .target(
            name: "HakkaCore",
            dependencies: [.product(name: "HakkaCommon", package: "ios")],
            path: "Sources/Core",
        ),
        .target(
            name: "HakkaServer",
            dependencies: ["HakkaCore", .product(name: "HakkaCommon", package: "ios")],
            path: "Sources/Server",
        ),
        .executableTarget(
            name: "HakkaApp",
            dependencies: [
                "HakkaCore",
                "HakkaServer",
                .product(name: "HakkaUI", package: "ios"),
            ],
            path: "Sources/App",
        ),
        .testTarget(
            name: "HakkaCoreTests",
            dependencies: ["HakkaCore", "HakkaServer"],
            path: "Tests/CoreTests",
        ),
        .testTarget(
            name: "HakkaAppTests",
            dependencies: ["HakkaApp", "HakkaCore"],
            path: "Tests/AppTests",
        ),
    ],
)
