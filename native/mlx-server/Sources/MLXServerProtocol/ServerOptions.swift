// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// The command line, in llama-server's words where it has them, so the app's driver launches either the same way.
public struct ServerOptions: Sendable, Equatable {
    /// The model's folder: config.json, safetensors weights, tokenizer and chat template.
    public var model: String
    /// The id the server answers to (`--alias`).
    public var alias: String
    public var host = "127.0.0.1"
    public var port = 8080
    /// The longest prompt plus answer one request may hold (`--ctx-size`); a longer prompt is refused as
    /// llama-server refuses it.
    public var contextSize = 32_768
    /// Each image becomes at least this many vision tokens (`--image-min-tokens`; llama-server's 1024 for Qwen-VL).
    public var imageMinTokens = 1_024
    /// The most vision tokens an image becomes.
    public var imageMaxTokens = 4_096
    /// MLX's buffer cache limit: freed GPU buffers kept for reuse, beyond what the model holds.
    public var cacheLimitMB = 1_024
    /// The answer's limit when the request names none.
    public var defaultMaxTokens = 4_096

    public init(model: String, alias: String) {
        self.model = model
        self.alias = alias
    }

    public static let usage = """
        usage: taalcut-mlx-server --model <dir> --alias <id> [--host 127.0.0.1] [--port 8080] [--ctx-size 32768]
               [--image-min-tokens 1024] [--image-max-tokens 4096] [--cache-limit-mb 1024]
               [--default-max-tokens 4096]
        environment: TAALCUT_MLX_API_KEY, the key every request but /health must carry as a bearer token
        """

    public enum ParseError: Error, Equatable { case usage(String) }

    public static func parse(_ arguments: [String]) throws -> ServerOptions {
        var values: [String: String] = [:]
        var index = 0
        while index < arguments.count {
            let flag = arguments[index]
            guard flag.hasPrefix("--"), index + 1 < arguments.count else {
                throw ParseError.usage("unexpected argument '\(flag)'")
            }
            values[flag] = arguments[index + 1]
            index += 2
        }
        let known: Set<String> = [
            "--model", "--alias", "--host", "--port", "--ctx-size", "--image-min-tokens", "--image-max-tokens",
            "--cache-limit-mb", "--default-max-tokens",
        ]
        if let unknown = values.keys.first(where: { !known.contains($0) }) {
            throw ParseError.usage("unknown flag '\(unknown)'")
        }
        guard let model = values["--model"], let alias = values["--alias"] else {
            throw ParseError.usage("--model and --alias are required")
        }
        var options = ServerOptions(model: model, alias: alias)
        func int(_ flag: String, _ range: ClosedRange<Int>) throws -> Int? {
            guard let text = values[flag] else { return nil }
            guard let value = Int(text), range.contains(value) else { throw ParseError.usage("bad \(flag) '\(text)'") }
            return value
        }
        if let host = values["--host"] {
            // Loopback only: nothing but the app on this Mac may talk to it.
            guard host == "127.0.0.1" || host == "::1" || host == "localhost" else {
                throw ParseError.usage("--host must be a loopback address")
            }
            options.host = host == "localhost" ? "127.0.0.1" : host
        }
        options.port = try int("--port", 1...65_535) ?? options.port
        options.contextSize = try int("--ctx-size", 512...1_048_576) ?? options.contextSize
        options.imageMinTokens = try int("--image-min-tokens", 1...65_536) ?? options.imageMinTokens
        options.imageMaxTokens = try int("--image-max-tokens", 1...65_536) ?? options.imageMaxTokens
        options.cacheLimitMB = try int("--cache-limit-mb", 0...1_048_576) ?? options.cacheLimitMB
        options.defaultMaxTokens = try int("--default-max-tokens", 1...1_048_576) ?? options.defaultMaxTokens
        guard options.imageMinTokens <= options.imageMaxTokens else {
            throw ParseError.usage("--image-min-tokens is above --image-max-tokens")
        }
        return options
    }
}

/// When a prompt may continue the cache the last one left: the hybrid models' recurrent layers can't be rewound,
/// so the cache is reused only when it holds exactly a prefix of the new prompt (an agent's next turn: the same
/// conversation with the last answer and the tools' results appended).
public enum PromptReuse {
    /// How many of `prompt`'s tokens the cache already holds, or 0 to start again.
    public static func reusable(cached: [Int], prompt: [Int]) -> Int {
        guard !cached.isEmpty, cached.count < prompt.count else { return 0 }
        return prompt.starts(with: cached) ? cached.count : 0
    }
}
