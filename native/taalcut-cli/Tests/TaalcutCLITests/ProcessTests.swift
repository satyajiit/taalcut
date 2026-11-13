// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutCLI

@Suite("the taalcut executable")
struct ProcessTests {
    @Test("taalcut mcp over real pipes: stdout holds only the JSON-RPC answer lines")
    func pipe() async throws {
        let binary = try #require(builtTaalcut())
        let server = try FakeHttpServer { request in
            request.body.contains("\"id\"")
                ? .events([.text("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n")])
                : .empty(status: 202)
        }
        try await server.start()
        defer { server.stop() }
        let output = try await runTaalcut(
            binary, ["mcp"],
            environment: ["TAALCUT_MCP_TOKEN": testToken, "TAALCUT_MCP_URL": server.url.absoluteString, "HOME": "/nonexistent"],
            input: "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
        #expect(output.status == 0)
        #expect(output.stdout == "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n")
        #expect(server.requests.count == 2)
        #expect(!output.stderr.contains(testToken))
    }

    @Test("a URL that isn't 127.0.0.1, or no token: exit 2 with nothing on stdout")
    func refusesBadSetup() async throws {
        let binary = try #require(builtTaalcut())
        let remote = try await runTaalcut(
            binary, ["mcp"], environment: ["TAALCUT_MCP_TOKEN": testToken, "TAALCUT_MCP_URL": "http://example.com/mcp"],
            input: "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n")
        #expect(remote.status == 2)
        #expect(remote.stdout.isEmpty)
        #expect(remote.stderr.contains("127.0.0.1"))
        let noToken = try await runTaalcut(binary, ["mcp"], environment: [:])
        #expect(noToken.status == 2)
        #expect(noToken.stdout.isEmpty)
        let tokenInArgv = try await runTaalcut(binary, ["mcp", testToken], environment: [:])
        #expect(tokenInArgv.status == 2)
    }

    @Test("--version, and anything else is usage with exit 2")
    func usage() async throws {
        let binary = try #require(builtTaalcut())
        let version = try await runTaalcut(binary, ["--version"], environment: [:])
        #expect(version.status == 0)
        #expect(version.stdout == "taalcut \(BuildStamp.version)\n")
        let bogus = try await runTaalcut(binary, ["frobnicate"], environment: [:])
        #expect(bogus.status == 2)
        #expect(bogus.stderr.contains("usage: taalcut mcp"))
        let guardWithoutPending = try await runTaalcut(binary, ["update-guard"], environment: [:])
        #expect(guardWithoutPending.status == 2)
    }

    @Test("the real process lister finds the app's executable by path, and the signaller stops it")
    func systemPorts() throws {
        let dir = temporaryDirectory("libproc")
        let executable = dir.appendingPathComponent("Taalcut.app/Contents/MacOS/Taalcut")
        try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: URL(fileURLWithPath: "/bin/sleep"), to: executable)
        let child = Process()
        child.executableURL = executable
        child.arguments = ["30"]
        try child.run()
        defer { if child.isRunning { child.terminate() } }
        let lister = LibprocProcessLister()
        var found: [Int32] = []
        for _ in 0..<50 where found.isEmpty {
            found = lister.pids(runningExecutable: executable)
            if found.isEmpty { usleep(20_000) }
        }
        #expect(found == [child.processIdentifier])
        #expect(lister.pids(runningExecutable: dir.appendingPathComponent("Other.app/Contents/MacOS/Taalcut")).isEmpty)
        let signals = PosixSignaller()
        #expect(signals.isAlive(child.processIdentifier))
        signals.terminate(child.processIdentifier)
        child.waitUntilExit()
        #expect(!signals.isAlive(child.processIdentifier))
        #expect(lister.pids(runningExecutable: executable).isEmpty)
    }
}
