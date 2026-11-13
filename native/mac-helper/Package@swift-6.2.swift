// swift-tools-version: 6.2
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import PackageDescription

// Swift 6.2+ selects this manifest. `traits: []` turns off FluidAudio's
// default NemoTextProcessing trait (its text-processing binary). ASR does not
// call it, and the TTS resources must not ship. The 6.0 manifest stays for
// older tools and cannot spell traits.
let package = Package(
    name: "TaalcutMacHelper",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "taalcut-mac-helper", targets: ["TaalcutMacHelper"]),
    ],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.7", traits: []),
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
