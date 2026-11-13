// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Where diagnostics go. Never stdout: for `taalcut mcp`, stdout carries only JSON-RPC.
public protocol DiagnosticLog: Sendable {
    func write(_ message: String)
}

/// stderr, one timestamped line per message (the app sends the guard's stderr to updates/guard.log).
public struct StderrLog: DiagnosticLog {
    private let prefix: String

    public init(prefix: String) {
        self.prefix = prefix
    }

    public func write(_ message: String) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        FileHandle.standardError.write(Data("\(stamp) [\(prefix)] \(message)\n".utf8))
    }
}
