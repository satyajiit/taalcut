// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// An image in a message: base64 bytes from a data URL (the app sends frames so; it never sends a remote URL).
public struct ImagePayload: Sendable, Equatable {
    public let data: Data
    public let mediaType: String
}

/// A tool call an earlier assistant turn made, as the history sends it back.
public struct ToolCallPayload: Sendable, Equatable {
    public let id: String?
    public let name: String
    /// The arguments as an object (Chat Completions sends them as a JSON string; a string that isn't an object
    /// becomes an empty one, as llama-server does).
    public let arguments: JSONValue
}

public struct ChatMessage: Sendable, Equatable {
    public enum Role: String, Sendable { case system, user, assistant, tool }
    /// One part of the content, in the order sent: the template writes them so (a question, then its frame).
    public enum Part: Sendable, Equatable { case text(String), image }
    public let role: Role
    public let text: String
    /// `nil` when the content was a plain string.
    public let parts: [Part]?
    public let images: [ImagePayload]
    public let toolCalls: [ToolCallPayload]
    public let toolCallId: String?
    public let name: String?
    public let reasoning: String?
}

public enum ToolChoice: Sendable, Equatable { case auto, none, required }

public struct ChatRequest: Sendable {
    public let model: String?
    public let messages: [ChatMessage]
    /// Each tool as sent (`{"type":"function","function":{...}}`), key order kept.
    public let tools: [JSONValue]
    public let toolChoice: ToolChoice
    /// Whether the model is shown the tools and its calls are parsed: some offered, and the choice isn't none.
    public var usesTools: Bool { !tools.isEmpty && toolChoice != .none }
    public let stream: Bool
    public let includeUsage: Bool
    public let temperature: Double?
    public let topP: Double?
    public let topK: Int?
    public let maxTokens: Int?
    public let seed: UInt64?
    public let stop: [String]
    /// `chat_template_kwargs`, e.g. `enable_thinking: false` (packages/models: thinkingKwarg).
    public let templateKwargs: [(String, JSONValue)]

    public var enableThinking: Bool? {
        templateKwargs.first { $0.0 == "enable_thinking" }?.1.bool
    }
}

public enum ChatRequestError: Error, Equatable, CustomStringConvertible {
    case notJSON
    case missing(String)
    case invalid(String)

    public var description: String {
        switch self {
        case .notJSON: "the body is not JSON"
        case .missing(let field): "'\(field)' is required"
        case .invalid(let detail): detail
        }
    }
}

extension ChatRequest {
    public static func decode(_ body: Data) throws -> ChatRequest {
        guard let root = try? JSONValue.parse(body), root.objectPairs != nil else { throw ChatRequestError.notJSON }
        guard let rawMessages = root["messages"]?.array else { throw ChatRequestError.missing("messages") }
        let messages = try rawMessages.map(decodeMessage)
        let tools = root["tools"]?.array ?? []
        let choice: ToolChoice =
            switch root["tool_choice"]?.string {
            case "none": .none
            case "required": .required
            default: .auto
            }
        let stop: [String] =
            if let one = root["stop"]?.string { [one] } else { root["stop"]?.array?.compactMap(\.string) ?? [] }
        let maxTokens = (root["max_completion_tokens"]?.number ?? root["max_tokens"]?.number).map { Int($0) }
        return ChatRequest(
            model: root["model"]?.string,
            messages: messages,
            tools: tools,
            toolChoice: choice,
            stream: root["stream"]?.bool ?? false,
            includeUsage: root["stream_options"]?["include_usage"]?.bool ?? false,
            temperature: root["temperature"]?.number,
            topP: root["top_p"]?.number,
            topK: root["top_k"]?.number.map { Int($0) },
            maxTokens: maxTokens.flatMap { $0 > 0 ? $0 : nil },
            seed: root["seed"]?.number.flatMap { $0 >= 0 ? UInt64($0) : nil },
            stop: stop,
            templateKwargs: root["chat_template_kwargs"]?.objectPairs ?? [])
    }

    static func decodeMessage(_ raw: JSONValue) throws -> ChatMessage {
        guard raw.objectPairs != nil else { throw ChatRequestError.invalid("a message is not an object") }
        let roleName = raw["role"]?.string ?? ""
        // pi-ai sends instructions as `developer` to models that take it; this server's models read them as system.
        let role: ChatMessage.Role
        switch roleName {
        case "system", "developer": role = .system
        case "user": role = .user
        case "assistant": role = .assistant
        case "tool": role = .tool
        default: throw ChatRequestError.invalid("unknown role '\(roleName)'")
        }
        var text = ""
        var images: [ImagePayload] = []
        var order: [ChatMessage.Part]?
        if let s = raw["content"]?.string {
            text = s
        } else if let parts = raw["content"]?.array {
            var texts: [String] = []
            order = []
            for part in parts {
                switch part["type"]?.string {
                case "text":
                    texts.append(part["text"]?.string ?? "")
                    order?.append(.text(texts.last!))
                case "image_url":
                    let url = part["image_url"]?["url"]?.string ?? part["image_url"]?.string ?? ""
                    images.append(try decodeDataURL(url))
                    order?.append(.image)
                default: continue
                }
            }
            text = texts.joined(separator: "\n")
        }
        let calls = try (raw["tool_calls"]?.array ?? []).map { call -> ToolCallPayload in
            guard let function = call["function"], let name = function["name"]?.string else {
                throw ChatRequestError.invalid("a tool call has no function name")
            }
            let arguments: JSONValue
            if let text = function["arguments"]?.string {
                let parsed = try? JSONValue.parse(text)
                arguments = parsed?.objectPairs != nil ? parsed! : .object([])
            } else if let object = function["arguments"], object.objectPairs != nil {
                arguments = object
            } else {
                arguments = .object([])
            }
            return ToolCallPayload(id: call["id"]?.string, name: name, arguments: arguments)
        }
        let reasoning = raw["reasoning_content"]?.string
        return ChatMessage(
            role: role, text: text, parts: order, images: images, toolCalls: calls,
            toolCallId: raw["tool_call_id"]?.string, name: raw["name"]?.string,
            reasoning: (reasoning?.isEmpty ?? true) ? nil : reasoning)
    }

    static func decodeDataURL(_ url: String) throws -> ImagePayload {
        guard url.hasPrefix("data:"), let comma = url.firstIndex(of: ",") else {
            throw ChatRequestError.invalid("images must be data URLs")
        }
        let header = url[url.index(url.startIndex, offsetBy: 5)..<comma]
        guard header.hasSuffix(";base64") else { throw ChatRequestError.invalid("images must be base64 data URLs") }
        let mediaType = String(header.dropLast(";base64".count))
        guard let data = Data(base64Encoded: String(url[url.index(after: comma)...])) else {
            throw ChatRequestError.invalid("an image's base64 doesn't decode")
        }
        return ImagePayload(data: data, mediaType: mediaType.isEmpty ? "image/jpeg" : mediaType)
    }
}
