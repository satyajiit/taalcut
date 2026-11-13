// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// The few facts the shim needs from one JSON-RPC line. The line itself is forwarded byte for byte.
struct JsonRpcMessage: Sendable, Equatable {
    /// `_meta` key a 2026-07-28 client puts its protocol revision under.
    static let protocolVersionMetaKey = "io.modelcontextprotocol/protocolVersion"

    /// The id re-serialised as JSON (`7`, `"abc"`); nil for notifications.
    let idJSON: String?
    let method: String?
    /// The revision named in `params._meta`: present only on 2026-07-28 traffic.
    let modernVersion: String?
    /// `params.name` (tools/call, prompts/get) or `params.uri` (resources/read), for `Mcp-Name`.
    let name: String?

    /// A request expects exactly one answer line with its id.
    var isRequest: Bool { idJSON != nil && method != nil }
    var isInitialize: Bool { method == "initialize" }

    /// nil when the line is not one JSON object (a batch array or junk is forwarded without headers).
    static func parse(_ line: String) -> JsonRpcMessage? {
        guard let data = line.data(using: .utf8),
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        let method = object["method"] as? String
        let params = object["params"] as? [String: Any]
        let meta = params?["_meta"] as? [String: Any]
        return JsonRpcMessage(
            idJSON: object["id"].flatMap(serialize),
            method: method,
            modernVersion: meta?[protocolVersionMetaKey] as? String,
            name: name(method: method, params: params)
        )
    }

    private static func name(method: String?, params: [String: Any]?) -> String? {
        switch method {
        case "tools/call", "prompts/get": return params?["name"] as? String
        case "resources/read": return params?["uri"] as? String
        default: return nil
        }
    }

    private static func serialize(_ value: Any) -> String? {
        if value is NSNull { return nil }
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
}

/// Lines the shim writes itself.
enum ShimReply {
    static let offCode = -32000
    static let offMessage = "External agents are off in Taalcut. Turn them on in Settings › External agents."
    static let revokedCode = -32001
    static let revokedMessage = "This Taalcut connection was revoked."
    static let internalErrorCode = -32603

    static func error(id: String, code: Int, message: String) -> String {
        "{\"jsonrpc\":\"2.0\",\"id\":\(id),\"error\":{\"code\":\(code),\"message\":\(quoted(message))}}"
    }

    /// A server's JSON-RPC error object put under the request's own id (a 403 carries no id).
    static func error(id: String, errorObject: String) -> String {
        "{\"jsonrpc\":\"2.0\",\"id\":\(id),\"error\":\(errorObject)}"
    }

    static func quoted(_ text: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        guard let data = try? encoder.encode(text), let string = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        return string
    }

    /// JSON may span lines only in whitespace (a newline inside a string is escaped), so joining with spaces keeps it one valid line.
    /// Each physical line starts and ends outside a string, so trimming them is safe too.
    static func oneLine(_ text: String) -> String {
        text.split(whereSeparator: { $0 == "\n" || $0 == "\r" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
