// swift-tools-version: 6.2
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import PackageDescription

// taalcut-mlx-server: the on-device model server for Apple silicon (MLX1). It serves the same OpenAI-compatible
// endpoints llama-server gives the app (packages/models SPEC "Embedded local runtime"). Build it with build.sh:
// xcodebuild compiles MLX's Metal shaders, which `swift build` can't.
let package = Package(
    name: "TaalcutMLXServer",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "taalcut-mlx-server", targets: ["TaalcutMLXServer"]),
    ],
    dependencies: [
        // MIT. MLXVLM serves Qwen3.5's text and frames from one set of weights; MLXLMCommon parses its tool calls.
        .package(url: "https://github.com/ml-explore/mlx-swift-lm", exact: "3.32.3"),
        // Apache-2.0. The tokenizer and the chat template (Jinja), from the model's own files.
        .package(url: "https://github.com/huggingface/swift-transformers", exact: "1.3.5"),
        // Apache-2.0. swift-transformers' template engine and its ordered dictionary: a tool's schema reaches the
        // template in the order it was written.
        .package(url: "https://github.com/huggingface/swift-jinja.git", exact: "2.5.2"),
        .package(url: "https://github.com/apple/swift-collections.git", exact: "1.7.5"),
    ],
    targets: [
        // HTTP, the OpenAI request and response shapes and the prompt-cache rule: no MLX, so its tests run anywhere.
        .target(name: "MLXServerProtocol"),
        .executableTarget(
            name: "TaalcutMLXServer",
            dependencies: [
                "MLXServerProtocol",
                .product(name: "MLXVLM", package: "mlx-swift-lm"),
                .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
                // XGrammar (Apache-2.0, with picojson BSD-2-Clause and dlpack Apache-2.0), vendored by mlx-swift-lm:
                // tool calls held to their tools' schemas, as llama-server's grammar holds them.
                .product(name: "MLXGuidedGeneration", package: "mlx-swift-lm"),
                .product(name: "Tokenizers", package: "swift-transformers"),
                .product(name: "Jinja", package: "swift-jinja"),
                .product(name: "OrderedCollections", package: "swift-collections"),
            ]
        ),
        .testTarget(name: "MLXServerProtocolTests", dependencies: ["MLXServerProtocol"]),
    ]
)
