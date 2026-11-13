// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

@testable import TaalcutCLI

let testToken = "tcm_" + String(repeating: "a", count: 43)

/// stdout as the test sees it.
actor CollectingSink: LineSink {
    private(set) var lines: [String] = []

    func emit(_ line: String) { lines.append(line) }

    func waitFor(_ count: Int, seconds: Double = 5) async -> [String] {
        let deadline = Date().addingTimeInterval(seconds)
        while lines.count < count, Date() < deadline { try? await Task.sleep(nanoseconds: 5_000_000) }
        return lines
    }
}

final class CollectingLog: DiagnosticLog, @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String] = []

    func write(_ message: String) {
        lock.lock()
        entries.append(message)
        lock.unlock()
    }

    var messages: [String] {
        lock.lock()
        defer { lock.unlock() }
        return entries
    }
}

/// Counts `open -g -b` calls; `onOpen` may bring a server up, as the app would.
final class FakeOpener: AppOpener, @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [String] = []
    private let onOpen: @Sendable () -> Void

    init(onOpen: @escaping @Sendable () -> Void = {}) {
        self.onOpen = onOpen
    }

    func open(bundleId: String) -> Bool {
        lock.lock()
        calls.append(bundleId)
        lock.unlock()
        onOpen()
        return true
    }

    var opened: [String] {
        lock.lock()
        defer { lock.unlock() }
        return calls
    }
}

/// A shim wired like `taalcut mcp`, reading `lines` instead of stdin.
struct ShimRun {
    let sink = CollectingSink()
    let log = CollectingLog()
    let opener: FakeOpener
    let shim: McpShim

    init(url: URL?, endpointFile: URL? = nil, opener: FakeOpener = FakeOpener(), waitSeconds: Double = 0.4) {
        var environment = ["TAALCUT_MCP_TOKEN": testToken]
        if let url { environment["TAALCUT_MCP_URL"] = url.absoluteString }
        let file = endpointFile ?? FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-cli-none-\(UUID().uuidString).json")
        environment["TAALCUT_MCP_ENDPOINT_FILE"] = file.path
        guard case .success(let parsed) = ShimEnvironment.parse(environment, home: URL(fileURLWithPath: "/nonexistent")) else {
            preconditionFailure("test environment must parse")
        }
        self.opener = opener
        var options = EndpointLocator.Options()
        options.bundleId = "com.taalcut.test"
        options.waitSeconds = waitSeconds
        options.pollMilliseconds = 20
        shim = McpCommand.makeShim(parsed, opener: opener, locatorOptions: options, sink: sink, log: log)
    }

    func send(_ lines: [String]) async -> [String] {
        await shim.run(AsyncStream { continuation in
            for line in lines { continuation.yield(line) }
            continuation.finish()
        })
        return await sink.lines
    }
}

func temporaryDirectory(_ name: String) -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-cli-\(name)-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}
