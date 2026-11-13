// swift-tools-version: 6.0
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import PackageDescription

// The `taalcut` command-line tool (mac helper SPEC, "Sibling: the taalcut
// command-line tool"): the stdio shim for external agents and the update
// rollback guard. No third-party dependencies, no entitlements.
let package = Package(
    name: "TaalcutCLI",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "taalcut", targets: ["TaalcutCommand"]),
    ],
    targets: [
        .target(name: "TaalcutCLI"),
        .executableTarget(name: "TaalcutCommand", dependencies: ["TaalcutCLI"]),
        .testTarget(name: "TaalcutCLITests", dependencies: ["TaalcutCLI", "TaalcutCommand"]),
    ]
)
