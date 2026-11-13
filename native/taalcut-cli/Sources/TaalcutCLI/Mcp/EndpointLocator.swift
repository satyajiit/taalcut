// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Darwin
import Foundation

/// Opens the app in the background (`open -g -b <bundle id>`).
public protocol AppOpener: Sendable {
    func open(bundleId: String) -> Bool
}

public struct BackgroundAppOpener: AppOpener {
    public init() {}

    public func open(bundleId: String) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-g", "-b", bundleId]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return false
        }
        process.waitUntilExit()
        return process.terminationStatus == 0
    }
}

/// Where the server is: TAALCUT_MCP_URL, else the endpoint file the app's mcp process writes. When nothing
/// answers, the app is opened once and waited for.
actor EndpointLocator {
    struct Options: Sendable {
        var bundleId = BuildStamp.appBundleId
        var waitSeconds: Double = 20
        var pollMilliseconds: UInt64 = 250
    }

    private let explicit: URL?
    private let file: URL
    private let opener: AppOpener
    private let options: Options
    private let log: DiagnosticLog
    private var launch: Task<URL?, Never>?

    init(explicit: URL?, file: URL, opener: AppOpener, options: Options, log: DiagnosticLog) {
        self.explicit = explicit
        self.file = file
        self.opener = opener
        self.options = options
        self.log = log
    }

    /// The server's URL right now, without opening anything.
    func current() -> URL? {
        explicit ?? Self.read(file, log: log)
    }

    /// Opens Taalcut (once per shim) and waits until its port takes connections. Later callers share the wait.
    func openAppAndWait() async -> URL? {
        if let launch { return await launch.value }
        let explicit = self.explicit, file = self.file, opener = self.opener, options = self.options, log = self.log
        let task = Task<URL?, Never> {
            log.write("Taalcut isn't answering; opening \(options.bundleId)")
            if !opener.open(bundleId: options.bundleId) { log.write("could not open \(options.bundleId)") }
            let deadline = Date().addingTimeInterval(options.waitSeconds)
            repeat {
                if let url = explicit ?? Self.read(file, log: log), PortProbe.accepts(url) { return url }
                try? await Task.sleep(nanoseconds: options.pollMilliseconds * 1_000_000)
            } while Date() < deadline
            log.write("Taalcut's MCP server didn't come up within \(Int(options.waitSeconds)) s")
            return nil
        }
        launch = task
        return await task.value
    }

    private struct EndpointFile: Decodable {
        let url: String
        let pid: Int32?
    }

    /// The endpoint file's URL when the file is valid, loopback-only and its writer is still alive.
    static func read(_ file: URL, log: DiagnosticLog) -> URL? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        guard let endpoint = try? JSONDecoder().decode(EndpointFile.self, from: data) else {
            log.write("ignoring \(file.path): not an endpoint file")
            return nil
        }
        guard let url = LoopbackURL.parse(endpoint.url) else {
            log.write("ignoring \(file.path): \(endpoint.url) is not http://127.0.0.1")
            return nil
        }
        if let pid = endpoint.pid, pid > 0, kill(pid, 0) != 0, errno == ESRCH { return nil }
        return url
    }
}

/// Whether a TCP connection to the URL's loopback port succeeds right now.
enum PortProbe {
    static func accepts(_ url: URL) -> Bool {
        guard let port = url.port.map(UInt16.init(clamping:)) ?? Optional(80) else { return false }
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return result == 0
    }
}
