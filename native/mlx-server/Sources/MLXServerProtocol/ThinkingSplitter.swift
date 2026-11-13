// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/// Splits a thinking model's answer into its reasoning and its reply. With thinking on, Qwen3.5's prompt ends in
/// `<think>`, so the answer opens in reasoning until `</think>`; with it off the prompt already closed the block.
public struct ThinkingSplitter: Sendable {
    public enum Part: Sendable, Equatable {
        case reasoning(String)
        case content(String)
    }

    private var inReasoning: Bool
    private var pending = ""
    private static let close = "</think>"

    public init(thinking: Bool) { inReasoning = thinking }

    public mutating func feed(_ text: String) -> [Part] {
        guard inReasoning else { return text.isEmpty ? [] : [.content(text)] }
        pending += text
        if let range = pending.range(of: Self.close) {
            let reasoning = String(pending[..<range.lowerBound])
            var reply = String(pending[range.upperBound...])
            while reply.hasPrefix("\n") { reply.removeFirst() }
            pending = ""
            inReasoning = false
            return (reasoning.isEmpty ? [] : [.reasoning(reasoning)]) + (reply.isEmpty ? [] : [.content(reply)])
        }
        // Hold back what could be the start of `</think>`.
        let keep = (1..<Self.close.count).reversed().first { pending.hasSuffix(Self.close.prefix($0)) } ?? 0
        let ready = String(pending.dropLast(keep))
        pending = String(pending.suffix(keep))
        return ready.isEmpty ? [] : [.reasoning(ready)]
    }

    public mutating func finish() -> [Part] {
        defer { pending = "" }
        guard !pending.isEmpty else { return [] }
        return inReasoning ? [.reasoning(pending)] : [.content(pending)]
    }
}
