// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutCLI

private func offLine(_ id: String) -> String {
    #"{"jsonrpc":"2.0","id":\#(id),"error":{"code":-32000,"message":"External agents are off in Taalcut. Turn them on in Settings › External agents."}}"#
}

@Suite("taalcut mcp when Taalcut isn't answering")
struct ShimOffTests {
    @Test("no endpoint file: opens the app once, waits, then answers each request as off")
    func noEndpoint() async {
        let run = ShimRun(url: nil)
        let lines = await run.send([
            #"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
            #"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
            #"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        ])
        #expect(Set(lines) == [offLine("1"), offLine("2")])
        #expect(run.opener.opened == ["com.taalcut.test"])
    }

    @Test("a refused port: opens the app, then off")
    func refusedPort() async throws {
        let url = try #require(URL(string: "http://127.0.0.1:\(closedLoopbackPort())/mcp"))
        let run = ShimRun(url: url)
        #expect(await run.send([#"{"jsonrpc":"2.0","id":"x","method":"tools/list"}"#]) == [offLine("\"x\"")])
        #expect(run.opener.opened.count == 1)
    }

    @Test("the app comes up while the shim waits: the request goes through")
    func appStartsDuringWait() async throws {
        let server = try FakeHttpServer { _ in .json(#"{"jsonrpc":"2.0","id":1,"result":{}}"#) }
        try await server.start()
        defer { server.stop() }
        let dir = temporaryDirectory("endpoint")
        let file = dir.appendingPathComponent("endpoint.json")
        let body = #"{"url":"\#(server.url.absoluteString)","pid":\#(getpid()),"startedAt":1}"#
        let opener = FakeOpener { try? Data(body.utf8).write(to: file) }
        let run = ShimRun(url: nil, endpointFile: file, opener: opener, waitSeconds: 3)
        #expect(await run.send([#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#]) == [#"{"jsonrpc":"2.0","id":1,"result":{}}"#])
        #expect(opener.opened.count == 1)
    }

    @Test("an endpoint file that isn't loopback, or whose writer died, is ignored")
    func untrustedEndpointFiles() async throws {
        let dir = temporaryDirectory("endpoint-bad")
        let file = dir.appendingPathComponent("endpoint.json")
        try Data(#"{"url":"http://example.com:41730/mcp","pid":1,"startedAt":1}"#.utf8).write(to: file)
        let log = CollectingLog()
        #expect(EndpointLocator.read(file, log: log) == nil)
        #expect(log.messages.contains { $0.contains("is not http://127.0.0.1") })
        try Data(#"{"url":"http://127.0.0.1:41730/mcp","pid":999999,"startedAt":1}"#.utf8).write(to: file)
        #expect(EndpointLocator.read(file, log: log) == nil)
        try Data(#"{"url":"http://127.0.0.1:41730/mcp","pid":\#(getpid()),"startedAt":1}"#.utf8).write(to: file)
        #expect(EndpointLocator.read(file, log: log)?.absoluteString == "http://127.0.0.1:41730/mcp")
    }
}
