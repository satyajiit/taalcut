// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutCLI

@Suite("taalcut mcp parsing")
struct ShimParsingTests {
    @Test("the token and URL come from the environment and must be a key and loopback")
    func environment() {
        let home = URL(fileURLWithPath: "/Users/someone")
        #expect(ShimEnvironment.parse([:], home: home) == .failure(.missingToken))
        #expect(ShimEnvironment.parse(["TAALCUT_MCP_TOKEN": "tcm_short"], home: home) == .failure(.malformedToken))
        #expect(ShimEnvironment.parse(["TAALCUT_MCP_TOKEN": testToken + "!"], home: home) == .failure(.malformedToken))
        for url in ["http://localhost:41730/mcp", "https://127.0.0.1:41730/mcp", "http://evil.example/mcp", "http://u:p@127.0.0.1:1/mcp", "http://[::1]:1/mcp"] {
            #expect(ShimEnvironment.parse(["TAALCUT_MCP_TOKEN": testToken, "TAALCUT_MCP_URL": url], home: home) == .failure(.notLoopback(url)))
        }
        guard case .success(let parsed) = ShimEnvironment.parse(["TAALCUT_MCP_TOKEN": testToken], home: home) else {
            Issue.record("a token alone must parse")
            return
        }
        #expect(parsed.explicitURL == nil)
        #expect(parsed.endpointFile.path == "/Users/someone/Library/Application Support/Taalcut/mcp/endpoint.json")
        let custom = ShimEnvironment.parse(
            ["TAALCUT_MCP_TOKEN": testToken, "TAALCUT_MCP_URL": "http://127.0.0.1:41730/mcp", "TAALCUT_MCP_ENDPOINT_FILE": "/x/e.json"],
            home: home)
        #expect((try? custom.get())?.explicitURL?.absoluteString == "http://127.0.0.1:41730/mcp")
        #expect((try? custom.get())?.endpointFile.path == "/x/e.json")
    }

    @Test("messages: ids keep their JSON form, names come from params, the revision from _meta")
    func messages() {
        let call = JsonRpcMessage.parse(#"{"jsonrpc":"2.0","id":"a-1","method":"tools/call","params":{"name":"t","_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}"#)
        #expect(call == JsonRpcMessage(idJSON: "\"a-1\"", method: "tools/call", modernVersion: "2026-07-28", name: "t"))
        let read = JsonRpcMessage.parse(#"{"jsonrpc":"2.0","id":12,"method":"resources/read","params":{"uri":"taalcut://x"}}"#)
        #expect(read?.idJSON == "12")
        #expect(read?.name == "taalcut://x")
        #expect(read?.isRequest == true)
        let note = JsonRpcMessage.parse(#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
        #expect(note?.isRequest == false)
        #expect(JsonRpcMessage.parse("[1,2]") == nil)
        #expect(JsonRpcMessage.parse("not json") == nil)
    }

    @Test("SSE: data lines joined, comments and other fields dropped, the last event flushed")
    func sse() {
        var decoder = SseDecoder()
        #expect(decoder.push(": ping") == nil)
        #expect(decoder.push("event: message") == nil)
        #expect(decoder.push("id: 4") == nil)
        #expect(decoder.push("data: {\"a\":") == nil)
        #expect(decoder.push("data:1}") == nil)
        #expect(decoder.push("") == "{\"a\":\n1}")
        #expect(decoder.push("") == nil)
        #expect(decoder.push("data: tail") == nil)
        #expect(decoder.flush() == "tail")
        #expect(ShimReply.oneLine("{\"a\":\n1}") == "{\"a\": 1}")
    }

    @Test("headers: 2025 initialize carries neither the version nor the session")
    func legacyHeaders() {
        let initialize = JsonRpcMessage.parse(#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#)
        let session = LegacySession(sessionId: "s", negotiatedVersion: "2025-11-25")
        let headers = HeaderPlan.headers(for: initialize, token: testToken, legacy: session)
        #expect(headers["MCP-Session-Id"] == nil)
        #expect(headers["MCP-Protocol-Version"] == nil)
        let batch = HeaderPlan.headers(for: nil, token: testToken, legacy: session)
        #expect(batch["MCP-Session-Id"] == "s")
        #expect(batch["Authorization"] == "Bearer \(testToken)")
    }
}
