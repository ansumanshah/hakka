// swift-tools-version: 6.0
import PackageDescription

/// Hakka for macOS — a native desktop inspector and API client.
///
/// Plugin-first by design (see `docs/.../adr/0008-desktop-plugin-products.md`):
/// the shippable units are SPM *products*, not an app. `HakkaDesktopCore` is
/// pure model/state with no UI and no server; `HakkaDesktopServer` is the
/// bridge hub actor; the executable is a thin host. Other Swift apps (Noodle,
/// Ramen) can depend on the products without inheriting the app shell.
///
/// The upstream `../../ios` package is consumed by path: HakkaCommon carries
/// the record contract, engines, and export writers that the desktop app must
/// agree with byte-for-byte, and HakkaUI carries the inspector views. Sharing
/// the source is the whole point — a fork would drift the moment a bug is
/// fixed on one side only.
let package = Package(
    name: "HakkaDesktop",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "HakkaDesktopCore", targets: ["HakkaDesktopCore"]),
        .library(name: "HakkaDesktopServer", targets: ["HakkaDesktopServer"]),
        .executable(name: "HakkaDesktop", targets: ["HakkaDesktopApp"]),
    ],
    dependencies: [
        .package(path: "../../ios"),
    ],
    targets: [
        .target(
            name: "HakkaDesktopCore",
            dependencies: [.product(name: "HakkaCommon", package: "ios")],
            path: "Sources/DesktopCore",
        ),
        .target(
            name: "HakkaDesktopServer",
            dependencies: ["HakkaDesktopCore", .product(name: "HakkaCommon", package: "ios")],
            path: "Sources/DesktopServer",
        ),
        .executableTarget(
            name: "HakkaDesktopApp",
            dependencies: [
                "HakkaDesktopCore",
                "HakkaDesktopServer",
                .product(name: "HakkaUI", package: "ios"),
            ],
            path: "Sources/HakkaDesktopApp",
        ),
        .testTarget(
            name: "HakkaDesktopCoreTests",
            dependencies: ["HakkaDesktopCore", "HakkaDesktopServer"],
            path: "Tests/DesktopCoreTests",
        ),
    ],
)
