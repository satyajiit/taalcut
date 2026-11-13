// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Where JSON-RPC lines for the client go. Each call is exactly one line.
public protocol LineSink: Sendable {
    func emit(_ line: String) async
}

/// stdout, one whole line per write, never interleaved.
public actor StdoutSink: LineSink {
    public init() {}

    public func emit(_ line: String) {
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
}
