// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// The 2025-11-25 connection state the shim keeps for a client that opened with `initialize`.
struct LegacySession: Sendable, Equatable {
    var sessionId: String?
    var negotiatedVersion: String?
}

/// The HTTP headers for one forwarded message (tools SPEC, "The stdio shim").
enum HeaderPlan {
    static func headers(for message: JsonRpcMessage?, token: String, legacy: LegacySession) -> [String: String] {
        var headers = [
            "Authorization": "Bearer \(token)",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        ]
        if let modern = message?.modernVersion {
            // 2026-07-28: no protocol session; the revision and the method ride on every request.
            headers["MCP-Protocol-Version"] = modern
            if let method = message?.method { headers["Mcp-Method"] = method }
            if let name = message?.name { headers["Mcp-Name"] = name }
            return headers
        }
        // 2025-11-25: initialize starts a new protocol session and carries neither header.
        if message?.isInitialize == true { return headers }
        if let version = legacy.negotiatedVersion { headers["MCP-Protocol-Version"] = version }
        if let session = legacy.sessionId { headers["MCP-Session-Id"] = session }
        return headers
    }
}
