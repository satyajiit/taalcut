// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutCLI

private let modernCall =
    #"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"timeline_swapClip","arguments":{"slot":2},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}"#

@Suite("taalcut mcp forwards messages")
struct ShimForwardTests {
    @Test("a 2026-07-28 call carries the bearer and the mirrored headers, and its JSON answer is one line")
    func modernHeaders() async throws {
        let server = try FakeHttpServer { _ in .json("{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 7,\n  \"result\": {}\n}") }
        try await server.start()
        defer { server.stop() }
        let lines = await ShimRun(url: server.url).send([modernCall])
        #expect(lines == [#"{ "jsonrpc": "2.0", "id": 7, "result": {} }"#])
        let request = try #require(server.requests.first)
        #expect(request.method == "POST")
        #expect(request.path == "/mcp")
        #expect(request.body == modernCall)
        #expect(request.headers["authorization"] == "Bearer \(testToken)")
        #expect(request.headers["content-type"] == "application/json")
        #expect(request.headers["accept"] == "application/json, text/event-stream")
        #expect(request.headers["mcp-protocol-version"] == "2026-07-28")
        #expect(request.headers["mcp-method"] == "tools/call")
        #expect(request.headers["mcp-name"] == "timeline_swapClip")
        #expect(request.headers["mcp-session-id"] == nil)
    }

    @Test("SSE events reach stdout as they arrive, keepalives dropped")
    func streamsEvents() async throws {
        let gate = Gate()
        let progress = #"{"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":0.5}}"#
        let result = #"{"jsonrpc":"2.0","id":7,"result":{"content":[]}}"#
        let server = try FakeHttpServer { _ in
            .events([
                .text(": keepalive\n\nevent: message\ndata: \(progress)\n\n"),
                .gate { await gate.wait() },
                .text("event: message\ndata: \(result)\n\n"),
            ])
        }
        try await server.start()
        defer { server.stop() }
        let run = ShimRun(url: server.url)
        let forwarding = Task { await run.send([modernCall]) }
        // The progress line is out while the server still holds the result.
        #expect(await run.sink.waitFor(1) == [progress])
        await gate.release()
        #expect(await forwarding.value == [progress, result])
    }

    @Test("a 2025 client: initialize opens a protocol session whose id and version ride on later requests")
    func legacySession() async throws {
        let initialize = #"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"codex","version":"1"}}}"#
        let list = #"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#
        let server = try FakeHttpServer { request in
            request.body.contains("initialize")
                ? .json(#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{}}}"#, headers: ["MCP-Session-Id": "s-123"])
                : .json(#"{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}"#)
        }
        try await server.start()
        defer { server.stop() }
        let run = ShimRun(url: server.url)
        _ = await run.send([initialize])
        let lines = await run.send([list])
        #expect(lines.count == 2)
        let first = try #require(server.requests.first)
        #expect(first.headers["mcp-protocol-version"] == nil)
        #expect(first.headers["mcp-session-id"] == nil)
        #expect(first.headers["mcp-method"] == nil)
        let second = try #require(server.requests.last)
        #expect(second.headers["mcp-protocol-version"] == "2025-11-25")
        #expect(second.headers["mcp-session-id"] == "s-123")
        #expect(second.headers["mcp-method"] == nil)
    }

    @Test("a notification answered 202 writes nothing")
    func notificationsAreQuiet() async throws {
        let server = try FakeHttpServer { _ in .empty(status: 202) }
        try await server.start()
        defer { server.stop() }
        let lines = await ShimRun(url: server.url).send([#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#])
        #expect(lines.isEmpty)
        #expect(server.requests.count == 1)
    }

    @Test("401 is the revoked message under the request's id; a notification gets nothing")
    func revoked() async throws {
        let server = try FakeHttpServer { _ in .empty(status: 401) }
        try await server.start()
        defer { server.stop() }
        let lines = await ShimRun(url: server.url).send([
            #"{"jsonrpc":"2.0","id":"abc","method":"tools/list"}"#,
            #"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"abc"}}"#,
        ])
        #expect(lines == [#"{"jsonrpc":"2.0","id":"abc","error":{"code":-32001,"message":"This Taalcut connection was revoked."}}"#])
    }

    @Test("a 403 JSON-RPC error without an id is answered under the request's id")
    func forbiddenKeepsTheError() async throws {
        let server = try FakeHttpServer { _ in
            .json(#"{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"Forbidden"}}"#, status: 403)
        }
        try await server.start()
        defer { server.stop() }
        let lines = await ShimRun(url: server.url).send([#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#])
        let answer = try #require(lines.first.flatMap(JsonText.object))
        #expect(lines.count == 1)
        #expect(answer["id"] as? Int == 3)
        let error = try #require(answer["error"] as? [String: Any])
        #expect(error["code"] as? Int == -32000)
        #expect(error["message"] as? String == "Forbidden")
    }

    @Test("an answer that isn't JSON-RPC becomes an internal error")
    func serverErrors() async throws {
        let server = try FakeHttpServer { _ in ScriptedResponse(status: 500, headers: [:], parts: [.text("oops")]) }
        try await server.start()
        defer { server.stop() }
        let lines = await ShimRun(url: server.url).send([#"{"jsonrpc":"2.0","id":4,"method":"tools/list"}"#])
        #expect(lines == [#"{"jsonrpc":"2.0","id":4,"error":{"code":-32603,"message":"Taalcut answered HTTP 500."}}"#])
    }

    @Test("a 404 ends the 2025 protocol session, so the next request goes without it")
    func endedSession() async throws {
        let server = try FakeHttpServer { request in
            if request.body.contains("initialize") {
                return .json(#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25"}}"#, headers: ["MCP-Session-Id": "s-1"])
            }
            return request.headers["mcp-session-id"] == nil ? .json(#"{"jsonrpc":"2.0","id":3,"result":{}}"#) : .empty(status: 404)
        }
        try await server.start()
        defer { server.stop() }
        let run = ShimRun(url: server.url)
        _ = await run.send([#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#])
        _ = await run.send([#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#])
        _ = await run.send([#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#])
        #expect(server.requests.map { $0.headers["mcp-session-id"] } == [nil, "s-1", nil])
        #expect(await run.sink.lines.last == #"{"jsonrpc":"2.0","id":3,"result":{}}"#)
    }
}
