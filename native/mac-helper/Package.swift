// swift-tools-version: 6.0
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import PackageDescription

let package = Package(
    name: "TaalcutMacHelper",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "taalcut-mac-helper", targets: ["TaalcutMacHelper"]),
    ],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.7"),
    ],
    targets: [
        .executableTarget(
            name: "TaalcutMacHelper",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio"),
            ]
        ),
        .testTarget(
            name: "TaalcutMacHelperTests",
            dependencies: ["TaalcutMacHelper"]
        ),
    ]
)
