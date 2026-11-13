// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Jinja
import MLXLMCommon
import Tokenizers

/// swift-transformers' tokenizer behind mlx-swift-lm's protocol (what mlx-swift-lm's `#huggingFaceTokenizerLoader`
/// macro writes, without the macro), reading only the model's folder: nothing is downloaded. It renders with the
/// chat template given (llama-server's `--chat-template`), else the model's own.
struct TransformersTokenizerLoader: MLXLMCommon.TokenizerLoader {
    let chatTemplate: String?

    func load(from directory: URL) async throws -> any MLXLMCommon.Tokenizer {
        let upstream = try await AutoTokenizer.from(modelFolder: directory)
        guard let source = try chatTemplate ?? Self.ownTemplate(in: directory) else {
            throw MLXLMCommon.TokenizerError.missingChatTemplate
        }
        return TokenizerBridge(upstream: upstream, template: try ChatTemplate(source))
    }

    /// The model's template: `chat_template.jinja`, else `chat_template` in `tokenizer_config.json`.
    static func ownTemplate(in directory: URL) throws -> String? {
        let file = directory.appendingPathComponent("chat_template.jinja")
        if FileManager.default.fileExists(atPath: file.path) { return try String(contentsOf: file, encoding: .utf8) }
        let config = directory.appendingPathComponent("tokenizer_config.json")
        guard let data = try? Data(contentsOf: config),
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return object["chat_template"] as? String
    }
}

/// The chat template, compiled once, rendered the way swift-transformers does but with the request's own messages
/// and tools (`templateMessagesKey`, `orderedToolKey`), so the prompt is the text llama-server renders (checked with
/// /apply-template on both). The app's templates write each tool compact, `tool | tojson(separators=(",", ":"))`
/// (packages/models chat-template.ts); swift-jinja's `tojson` takes no `separators`, so that one call becomes a
/// function that writes the same JSON.
struct ChatTemplate: Sendable {
    static let compactCall = #"tool | tojson(separators=(",", ":"))"#
    static let compactFunction = "taalcut_compact_json"

    let template: Template

    init(_ source: String) throws {
        let text = source.replacingOccurrences(of: Self.compactCall, with: "\(Self.compactFunction)(tool)")
        // What swift-transformers compiles chat templates with.
        template = try Template(text, with: .init(lstripBlocks: true, trimBlocks: true))
    }

    func render(context: [String: Jinja.Value]) throws -> String {
        let environment = Environment()
        environment[Self.compactFunction] = .function { arguments, _, _ in
            guard let value = arguments.first else { return .string("null") }
            return .string(
                try JSON.dumps(value, options: .init(ensureASCII: false, separators: (item: ",", key: ":"))))
        }
        return try template.render(context, environment: environment)
    }
}

struct TokenizerBridge: MLXLMCommon.Tokenizer {
    let upstream: any Tokenizers.Tokenizer
    let template: ChatTemplate

    func encode(text: String, addSpecialTokens: Bool) -> [Int] {
        upstream.encode(text: text, addSpecialTokens: addSpecialTokens)
    }

    func decode(tokenIds: [Int], skipSpecialTokens: Bool) -> String {
        upstream.decode(tokens: tokenIds, skipSpecialTokens: skipSpecialTokens)
    }

    func convertTokenToId(_ token: String) -> Int? { upstream.convertTokenToId(token) }
    func convertIdToToken(_ id: Int) -> String? { upstream.convertIdToToken(id) }

    var bosToken: String? { upstream.bosToken }
    var eosToken: String? { upstream.eosToken }
    var unknownToken: String? { upstream.unknownToken }

    func applyChatTemplate(
        messages: [[String: any Sendable]],
        tools: [[String: any Sendable]]?,
        additionalContext: [String: any Sendable]?
    ) throws -> [Int] {
        var additionalContext = additionalContext ?? [:]
        let own = additionalContext.removeValue(forKey: templateMessagesKey) as? Jinja.Value
        var context: [String: Jinja.Value] = [
            "messages": try own ?? .array(messages.map { try Jinja.Value(any: $0) }),
            "add_generation_prompt": .boolean(true),
        ]
        if let tools {
            context["tools"] = .array(
                try tools.map { tool in try (tool[orderedToolKey] as? Jinja.Value) ?? Jinja.Value(any: tool) })
        }
        for (key, value) in additionalContext { context[key] = try Jinja.Value(any: value) }
        if let bos = upstream.bosToken { context["bos_token"] = .string(bos) }
        if let eos = upstream.eosToken { context["eos_token"] = .string(eos) }
        return upstream.encode(text: try template.render(context: context), addSpecialTokens: false)
    }
}
