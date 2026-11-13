// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/// Server-sent events, one line at a time: a blank line ends an event, and an event's `data:` lines are its
/// message. Comments (keepalives) and other fields are dropped.
struct SseDecoder {
    private var data: [String] = []

    /// The completed event's data, when `line` ends one.
    mutating func push(_ line: String) -> String? {
        if line.isEmpty { return flush() }
        if line.hasPrefix(":") { return nil }
        guard line.hasPrefix("data:") else { return nil }
        var value = line.dropFirst(5)
        if value.first == " " { value = value.dropFirst() }
        data.append(String(value))
        return nil
    }

    /// The last event when the stream ends without a blank line.
    mutating func flush() -> String? {
        defer { data = [] }
        guard !data.isEmpty else { return nil }
        let joined = data.joined(separator: "\n")
        return joined.isEmpty ? nil : joined
    }
}
