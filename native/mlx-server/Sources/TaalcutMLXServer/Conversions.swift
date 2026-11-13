// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreImage
import Foundation
import Jinja
import MLXLMCommon
import MLXServerProtocol
import OrderedCollections

typealias WireJSON = MLXServerProtocol.JSONValue

extension WireJSON {
    /// For the chat template: objects stay in their order (Jinja.Value passes through swift-transformers as is).
    var jinja: Jinja.Value {
        switch self {
        case .null: .null
        case .bool(let b): .boolean(b)
        case .int(let i): .int(i)
        case .double(let d): .double(d)
        case .string(let s): .string(s)
        case .array(let items): .array(items.map(\.jinja))
        case .object(let pairs):
            .object(OrderedDictionary(uniqueKeysWithValues: pairs.map { (ObjectKey.string($0.0), $0.1.jinja) }))
        }
    }

    /// For mlx-swift-lm's tool-call parser, which reads the schemas as plain Swift values.
    var sendable: any Sendable {
        switch self {
        case .null: NSNull()
        case .bool(let b): b
        case .int(let i): i
        case .double(let d): d
        case .string(let s): s
        case .array(let items): items.map(\.sendable) as [any Sendable]
        case .object(let pairs):
            Dictionary(pairs.map { ($0.0, $0.1.sendable) }, uniquingKeysWith: { _, last in last })
                as [String: any Sendable]
        }
    }

    var mlx: MLXLMCommon.JSONValue {
        switch self {
        case .null: .null
        case .bool(let b): .bool(b)
        case .int(let i): .int(i)
        case .double(let d): .double(d)
        case .string(let s): .string(s)
        case .array(let items): .array(items.map(\.mlx))
        case .object(let pairs): .object(Dictionary(pairs.map { ($0.0, $0.1.mlx) }, uniquingKeysWith: { _, b in b }))
        }
    }

    init(_ value: MLXLMCommon.JSONValue) {
        switch value {
        case .null: self = .null
        case .bool(let b): self = .bool(b)
        case .int(let i): self = .int(i)
        case .double(let d): self = .double(d)
        case .string(let s): self = .string(s)
        case .array(let items): self = .array(items.map(WireJSON.init))
        case .object(let dict): self = .object(dict.keys.sorted().map { ($0, WireJSON(dict[$0]!)) })
        }
    }
}

/// A tool as the chat template gets it: the top level a dictionary (swift-transformers sorts its keys), each value
/// ordered inside.
/// The key a tool travels under, whole, from the request to the chat template (TokenizerBridge): a Swift dictionary
/// would lose its key order, and the template writes the tool as JSON in that order, as llama-server does.
let orderedToolKey = "taalcut.orderedTool"

func templateTool(_ tool: WireJSON) -> [String: any Sendable] {
    [orderedToolKey: tool.jinja]
}

/// The key the request's messages travel under, already in the chat template's shape, from the engine to the
/// template (TokenizerBridge), in place of the ones mlx-swift-lm writes from `Chat.Message`: those lose the order of
/// a call's arguments, the order of a message's text and images, and the reasoning an assistant turn sends back.
/// These are what llama-server gives its template: string content (text parts joined), the parts in order when a
/// message has images, `reasoning_content`, and each call's arguments as an object in the order written.
let templateMessagesKey = "taalcut.messages"

func templateMessages(_ messages: [ChatMessage]) -> Jinja.Value {
    .array(
        messages.map { message in
            var out: [(String, WireJSON)] = [("role", .string(message.role.rawValue))]
            if let parts = message.parts, !message.images.isEmpty {
                out.append(
                    ("content",
                     .array(
                        parts.map { part in
                            switch part {
                            case .text(let text): .object([("type", .string("text")), ("text", .string(text))])
                            case .image: .object([("type", .string("image"))])
                            }
                        })))
            } else {
                out.append(("content", .string(message.text)))
            }
            if let reasoning = message.reasoning { out.append(("reasoning_content", .string(reasoning))) }
            if !message.toolCalls.isEmpty {
                out.append(
                    ("tool_calls",
                     .array(
                        message.toolCalls.map { call in
                            .object(
                                [("type", .string("function"))]
                                    + (call.id.map { [("id", WireJSON.string($0))] } ?? [])
                                    + [("function", .object([("name", .string(call.name)),
                                                             ("arguments", pythonScalars(call.arguments))]))])
                        })))
            }
            if let id = message.toolCallId { out.append(("tool_call_id", .string(id))) }
            if let name = message.name { out.append(("name", .string(name))) }
            return WireJSON.object(out).jinja
        })
}

/// A call's arguments with each top-level true, false and null as the text Python's `str` gives them. Templates write
/// a scalar argument with `| string`, which in Python's Jinja and in llama.cpp's gives `True`, `False` and `None`
/// (the form the model was trained on); swift-jinja's gives `true`, `false` and `none`.
func pythonScalars(_ arguments: WireJSON) -> WireJSON {
    guard let pairs = arguments.objectPairs else { return arguments }
    return .object(
        pairs.map { key, value in
            switch value {
            case .bool(let flag): (key, .string(flag ? "True" : "False"))
            case .null: (key, .string("None"))
            default: (key, value)
            }
        })
}

func parserTool(_ tool: WireJSON) -> [String: any Sendable] {
    (tool.sendable as? [String: any Sendable]) ?? [:]
}

/// A generated call's arguments as compact JSON, in the order its tool's schema lists the parameters (the order the
/// model writes them in), then any others by name.
func argumentsJSON(_ arguments: [String: MLXLMCommon.JSONValue], schema: WireJSON?) -> String {
    let declared = schema?["function"]?["parameters"]?["properties"]?.objectPairs?.map(\.0) ?? []
    var keys = declared.filter { arguments[$0] != nil }
    keys += arguments.keys.filter { !declared.contains($0) }.sorted()
    return WireJSON.object(keys.map { ($0, WireJSON(arguments[$0]!)) }).serialized()
}

/// The conversation as mlx-swift-lm's structured chat, which the model's message generator turns into the
/// template's messages (images first in a user turn, as Qwen's processor wants them).
func chatMessages(_ messages: [ChatMessage]) throws -> [Chat.Message] {
    try messages.map { message in
        switch message.role {
        case .system:
            return .system(message.text)
        case .user:
            let images = try message.images.map { payload -> UserInput.Image in
                guard let image = CIImage(data: payload.data, options: [.applyOrientationProperty: true]) else {
                    throw ChatRequestError.invalid("an image could not be decoded")
                }
                return .ciImage(image)
            }
            return .user(message.text, images: images)
        case .assistant:
            let calls = message.toolCalls.map { call in
                ToolCall(
                    function: .init(
                        name: call.name,
                        arguments: Dictionary(
                            (call.arguments.objectPairs ?? []).map { ($0.0, $0.1.mlx) },
                            uniquingKeysWith: { _, b in b })),
                    id: call.id)
            }
            return .assistant(message.text, toolCalls: calls.isEmpty ? nil : calls)
        case .tool:
            return .tool(message.text, id: message.toolCallId, name: message.name)
        }
    }
}
