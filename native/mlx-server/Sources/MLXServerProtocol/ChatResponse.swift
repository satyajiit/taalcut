// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// A tool call this server parsed from the model's output.
public struct GeneratedToolCall: Sendable, Equatable {
    public let id: String
    public let name: String
    /// The arguments as a JSON object, compact.
    public let argumentsJSON: String

    public init(id: String, name: String, argumentsJSON: String) {
        self.id = id
        self.name = name
        self.argumentsJSON = argumentsJSON
    }
}

/// llama-server's `timings` (prompt and decode counts and speeds), which the benchmarks read.
public struct Timings: Sendable, Equatable {
    public var cachedTokens: Int
    public var promptTokens: Int
    public var promptMs: Double
    public var generatedTokens: Int
    public var generateMs: Double

    public init(cachedTokens: Int, promptTokens: Int, promptMs: Double, generatedTokens: Int, generateMs: Double) {
        self.cachedTokens = cachedTokens
        self.promptTokens = promptTokens
        self.promptMs = promptMs
        self.generatedTokens = generatedTokens
        self.generateMs = generateMs
    }

    var json: JSONValue {
        let pps = promptMs > 0 ? Double(promptTokens) / promptMs * 1000 : 0
        let gps = generateMs > 0 ? Double(generatedTokens) / generateMs * 1000 : 0
        return .object([
            ("cache_n", .int(cachedTokens)),
            ("prompt_n", .int(promptTokens)),
            ("prompt_ms", .double(promptMs)),
            ("prompt_per_second", .double(pps)),
            ("predicted_n", .int(generatedTokens)),
            ("predicted_ms", .double(generateMs)),
            ("predicted_per_second", .double(gps)),
        ])
    }
}

public enum FinishReason: String, Sendable { case stop, length, toolCalls = "tool_calls" }

/// Builds Chat Completions responses: the streamed chunks pi-ai's openai-completions reader takes (role, content
/// deltas, each tool call whole with its index, a finish_reason, then usage) and the whole response.
public struct ChatResponseEncoder: Sendable {
    public let id: String
    public let created: Int
    public let model: String

    public init(id: String, created: Int, model: String) {
        self.id = id
        self.created = created
        self.model = model
    }

    private func chunk(_ choices: [JSONValue], extra: [(String, JSONValue)] = []) -> Data {
        let body: JSONValue = .object(
            [
                ("id", .string(id)),
                ("object", .string("chat.completion.chunk")),
                ("created", .int(created)),
                ("model", .string(model)),
                ("choices", .array(choices)),
            ] + extra)
        return Data("data: \(body.serialized())\n\n".utf8)
    }

    private func choice(delta: [(String, JSONValue)], finish: FinishReason? = nil) -> JSONValue {
        .object([
            ("index", .int(0)),
            ("delta", .object(delta)),
            ("finish_reason", finish.map { .string($0.rawValue) } ?? .null),
        ])
    }

    public func roleEvent() -> Data {
        chunk([choice(delta: [("role", .string("assistant")), ("content", .string(""))])])
    }

    public func contentEvent(_ text: String) -> Data {
        chunk([choice(delta: [("content", .string(text))])])
    }

    public func reasoningEvent(_ text: String) -> Data {
        chunk([choice(delta: [("reasoning_content", .string(text))])])
    }

    public func toolCallEvent(_ call: GeneratedToolCall, index: Int) -> Data {
        let entry: JSONValue = .object([
            ("index", .int(index)),
            ("id", .string(call.id)),
            ("type", .string("function")),
            ("function", .object([("name", .string(call.name)), ("arguments", .string(call.argumentsJSON))])),
        ])
        return chunk([choice(delta: [("tool_calls", .array([entry]))])])
    }

    public func finishEvent(_ reason: FinishReason, timings: Timings?) -> Data {
        chunk([choice(delta: [], finish: reason)], extra: timings.map { [("timings", $0.json)] } ?? [])
    }

    public func usageEvent(_ timings: Timings) -> Data {
        chunk([], extra: [("usage", usage(timings))])
    }

    public static let done = Data("data: [DONE]\n\n".utf8)

    func usage(_ t: Timings) -> JSONValue {
        let prompt = t.promptTokens + t.cachedTokens
        return .object([
            ("prompt_tokens", .int(prompt)),
            ("completion_tokens", .int(t.generatedTokens)),
            ("total_tokens", .int(prompt + t.generatedTokens)),
            ("prompt_tokens_details", .object([("cached_tokens", .int(t.cachedTokens))])),
        ])
    }

    /// The whole response, for a request that didn't ask to stream.
    public func completion(
        content: String, reasoning: String, toolCalls: [GeneratedToolCall], finish: FinishReason, timings: Timings
    ) -> Data {
        var message: [(String, JSONValue)] = [("role", .string("assistant")), ("content", .string(content))]
        if !reasoning.isEmpty { message.append(("reasoning_content", .string(reasoning))) }
        if !toolCalls.isEmpty {
            message.append(
                (
                    "tool_calls",
                    .array(
                        toolCalls.map { call in
                            .object([
                                ("id", .string(call.id)),
                                ("type", .string("function")),
                                (
                                    "function",
                                    .object([("name", .string(call.name)), ("arguments", .string(call.argumentsJSON))])
                                ),
                            ])
                        })
                ))
        }
        let body: JSONValue = .object([
            ("id", .string(id)),
            ("object", .string("chat.completion")),
            ("created", .int(created)),
            ("model", .string(model)),
            (
                "choices",
                .array([
                    .object([
                        ("index", .int(0)),
                        ("message", .object(message)),
                        ("finish_reason", .string(finish.rawValue)),
                    ])
                ])
            ),
            ("usage", usage(timings)),
            ("timings", timings.json),
        ])
        return Data(body.serialized().utf8)
    }
}
