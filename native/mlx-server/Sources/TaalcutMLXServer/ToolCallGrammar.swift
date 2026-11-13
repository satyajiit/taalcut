// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import MLX
import MLXGuidedGeneration
import MLXLMCommon
import MLXServerProtocol

/// Tool calls constrained to their tools' schemas (MLX1; the rule is `ToolCallStructure`), on XGrammar as
/// mlx-swift-lm vendors it (MLXGuidedGeneration). The model's vocabulary is bound once; each set of tools the app
/// offers is compiled once and kept, since the agent offers the same few sets turn after turn.
final class ToolCallGrammar: @unchecked Sendable {
    let open: Int
    let thinkStart: Int?
    let thinkEnd: Int?
    /// Tokens that end the answer: never inside a call (XGrammar would read `<|endoftext|>` as text).
    let stops: Set<Int>
    let vocabularySize: Int
    /// Tokens that are only spaces, tabs or newlines (see `ToolCallState.whitespaceRun`).
    let whitespace: Set<Int>
    private let vocabulary: GrammarTokenizer
    private let lock = NSLock()
    private var compiled: [String: CompiledTools] = [:]
    private var recent: [String] = []
    private static let kept = 16

    /// Nil when the model has no `<tool_call>` token (its calls then go unconstrained).
    init?(tokenizer: any MLXLMCommon.Tokenizer) throws {
        guard let open = tokenizer.convertTokenToId("<tool_call>") else { return nil }
        self.open = open
        thinkStart = tokenizer.convertTokenToId("<think>")
        thinkEnd = tokenizer.convertTokenToId("</think>")
        let stopTexts = ["<|im_end|>", "<|endoftext|>", tokenizer.eosToken].compactMap { $0 }
        stops = Set(stopTexts.compactMap { tokenizer.convertTokenToId($0) })
        let extracted = TokenizerVocabExtractor.extractForGrammar(from: tokenizer)
        vocabularySize = extracted.vocab.count
        // Byte-level pieces spell a space Ġ, a newline Ċ, a tab ĉ and a carriage return č.
        let blank: Set<Character> = [" ", "\n", "\t", "\r", "\u{120}", "\u{10A}", "\u{109}", "\u{10D}"]
        whitespace = Set(extracted.vocab.indices.filter { id in
            let piece = extracted.vocab[id]
            return !piece.isEmpty && piece.allSatisfy(blank.contains)
        })
        vocabulary = try GrammarTokenizer(
            vocab: extracted.vocab, vocabType: extracted.vocabType,
            eosTokenId: Int32(tokenizer.convertTokenToId("<|im_end|>") ?? stops.min() ?? 0))
    }

    /// Drops a grammar whose matcher couldn't be set back to its start: the next request compiles it again.
    func forget(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        compiled[key] = nil
        recent.removeAll { $0 == key }
    }

    /// The grammar for these tools: kept from an earlier request, or compiling now in the background, so the compile
    /// (seconds, against Qwen's 248k-token vocabulary) runs while the prompt is read and the call waits for it only
    /// if the model gets to `<tool_call>` first. Its one matcher serves every call in turn (requests run one at a
    /// time), set back to its start after each call: XGrammar v0.1.30 has no fork.
    func prepare(_ tools: [MLXServerProtocol.JSONValue]) -> CompiledTools {
        let key = MLXServerProtocol.JSONValue.array(tools).serialized()
        lock.lock()
        defer { lock.unlock() }
        recent.removeAll { $0 == key }
        recent.append(key)
        if let kept = compiled[key] { return kept }
        let fresh = CompiledTools(key: key) { [self] in compile(tools) }
        compiled[key] = fresh
        if recent.count > Self.kept { compiled[recent.removeFirst()] = nil }
        return fresh
    }

    private func compile(_ tools: [MLXServerProtocol.JSONValue]) -> GrammarConstraint? {
        let started = Date()
        func attempt(_ relaxed: Set<String>) throws -> GrammarConstraint {
            try GrammarConstraint(
                tokenizer: vocabulary,
                structuralTag: ToolCallStructure.structuralTag(tools: tools, relaxed: relaxed))
        }
        func done(_ grammar: GrammarConstraint, _ relaxed: Set<String>) -> GrammarConstraint {
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            let note = relaxed.isEmpty ? "" : ", any arguments for \(relaxed.sorted().joined(separator: ", "))"
            let count = ToolCallStructure.functions(tools).count
            grammarLog("tool-call grammar for \(count) tools compiled in \(ms) ms\(note)")
            return grammar
        }
        do {
            return done(try attempt([]), [])
        } catch {
            grammarLog("tool-call grammar: \(error); finding the schemas it can't take")
        }
        // One tool at a time: the ones XGrammar refuses keep their names with any arguments.
        var relaxed = Set<String>()
        for (name, _) in ToolCallStructure.functions(tools) {
            let one = tools.filter { (($0["function"] ?? $0)["name"]?.string) == name }
            let structure = ToolCallStructure.structuralTag(tools: one)
            if (try? GrammarConstraint(tokenizer: vocabulary, structuralTag: structure)) == nil { relaxed.insert(name) }
        }
        do {
            return done(try attempt(relaxed), relaxed)
        } catch {
            grammarLog("tool-call grammar: \(error); this request's calls go unconstrained")
            return nil
        }
    }

    /// Whether a mask leaves nothing but the stop tokens: the call is complete.
    func onlyStops(_ mask: [Int32]) -> Bool {
        for (index, word) in mask.enumerated() where word != 0 {
            for bit in 0 ..< 32 where word & Int32(bitPattern: UInt32(1) << UInt32(bit)) != 0 {
                if !stops.contains(index * 32 + bit) { return false }
            }
        }
        return true
    }

    /// Where each token's bit is in XGrammar's mask, for the logits' width (built once per width).
    private var layout: (width: Int, word: MLXArray, shift: MLXArray)?

    /// The mask as logits to add: 0 where the grammar takes the token, minus infinity elsewhere (the stop tokens too,
    /// the logits past the vocabulary, and with `blockWhitespace` the whitespace tokens).
    func additive(_ mask: [Int32], width: Int, blockWhitespace: Bool) -> MLXArray {
        let covered = min(vocabularySize, width)
        lock.lock()
        if layout?.width != width {
            layout = (
                width,
                MLXArray((0 ..< covered).map { Int32($0 >> 5) }),
                MLXArray((0 ..< covered).map { UInt32($0 & 31) })
            )
        }
        let (_, wordAt, shiftAt) = layout!
        lock.unlock()
        var words = mask.map { UInt32(bitPattern: $0) }
        for stop in stops where stop < covered { words[stop >> 5] &= ~(UInt32(1) << UInt32(stop & 31)) }
        if blockWhitespace {
            for blank in whitespace where blank < covered { words[blank >> 5] &= ~(UInt32(1) << UInt32(blank & 31)) }
        }
        let bits = bitwiseAnd(rightShift(MLXArray(words).take(wordAt, axis: 0), shiftAt), MLXArray(UInt32(1)))
        var add = MLX.where(bits .== MLXArray(UInt32(1)), MLXArray(Float(0)), MLXArray(-Float.infinity))
        if width > covered {
            add = concatenated([add, MLXArray([Float](repeating: -.infinity, count: width - covered))], axis: 0)
        }
        return add
    }
}

/// One answer's processor: it watches the answer for `<tool_call>` and, inside a call, takes away every token the
/// grammar can't take. A request without tools has none, so nothing changes for frames and plain text.
struct ToolCallProcessor: LogitProcessor {
    let state: ToolCallState

    mutating func prompt(_ prompt: MLXArray) {}

    func process(logits: MLXArray) -> MLXArray {
        state.catchUp()
        guard let mask = state.mask else { return logits }
        return logits + state.grammar.additive(
            mask, width: logits.dim(-1), blockWhitespace: state.whitespaceRun >= ToolCallState.whitespaceLimit)
    }

    mutating func didSample(token: MLXArray) {
        state.pending = token
    }
}

/// The processor's state, a class so that `process` (not mutating) can advance it. The engine calls `finish()` when
/// the answer ends, however it ends, so the shared matcher is back at its start for the next call.
final class ToolCallState: @unchecked Sendable {
    let grammar: ToolCallGrammar
    private let tools: CompiledTools
    private var matcher: GrammarConstraint?
    private var trigger: ToolCallTrigger
    /// The token just sampled, still on the GPU: read at the next step, when the forward pass that needs it is
    /// already queued, so watching costs the decode no extra wait.
    var pending: MLXArray?
    /// Inside a call: the tokens the matcher has taken since `<tool_call>`.
    private var accepted: Int32?
    private(set) var mask: [Int32]?
    private(set) var calls = 0
    /// Whitespace tokens in a row inside the call. XGrammar allows any amount of whitespace between a call's parts,
    /// and a model held away from what it wanted to write can pick whitespace forever (the 9B wrote newlines to its
    /// token limit); after `whitespaceLimit` in a row the next token must be something else, as llama.cpp's grammar
    /// caps the whitespace it allows.
    private(set) var whitespaceRun = 0
    static let whitespaceLimit = 4

    init(grammar: ToolCallGrammar, tools: CompiledTools, trigger: ToolCallTrigger) {
        self.grammar = grammar
        self.tools = tools
        self.trigger = trigger
    }

    func catchUp() {
        guard let token = pending else { return }
        pending = nil
        let id = token.item(Int.self)
        do {
            if let taken = accepted, let matcher {
                _ = try matcher.commitToken(Int32(id))
                accepted = taken + 1
                whitespaceRun = grammar.whitespace.contains(id) ? whitespaceRun + 1 : 0
                next(try matcher.computeMask())
            } else if trigger.opens(id), let ready = tools.matcher {
                matcher = ready
                accepted = 0
                calls += 1
                next(try ready.computeMask())
            }
        } catch {
            grammarLog("tool-call grammar left off: \(error)")
            close()
        }
    }

    func finish() {
        pending = nil
        close()
    }

    private func next(_ result: MaskResult) {
        if result.isTerminated || grammar.onlyStops(result.mask) {
            close()
        } else {
            mask = result.mask
        }
    }

    private func close() {
        mask = nil
        whitespaceRun = 0
        guard let taken = accepted, let matcher else { return }
        accepted = nil
        do {
            if taken > 0 { try matcher.rollback(taken) }
        } catch {
            grammarLog("tool-call grammar not set back (\(error)); it compiles again")
            grammar.forget(tools.key)
        }
    }
}

/// One set of tools' grammar, compiling on a background queue until it is ready.
final class CompiledTools: @unchecked Sendable {
    let key: String
    private let done = DispatchGroup()
    private var value: GrammarConstraint?

    init(key: String, compile: @escaping @Sendable () -> GrammarConstraint?) {
        self.key = key
        done.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            self.value = compile()
            self.done.leave()
        }
    }

    /// The matcher, once compiled (waiting for it if need be); nil when XGrammar couldn't have it.
    var matcher: GrammarConstraint? {
        done.wait()
        return value
    }
}

private func grammarLog(_ line: String) {
    FileHandle.standardError.write(Data("[mlx-server] \(line)\n".utf8))
}
