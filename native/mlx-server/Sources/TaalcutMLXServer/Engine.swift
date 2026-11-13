// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import MLX
import MLXLMCommon
import MLXServerProtocol
import MLXVLM

enum EngineEvent: Sendable {
    case content(String)
    case reasoning(String)
    case toolCall(GeneratedToolCall)
}

extension EngineEvent {
    init(_ part: ThinkingSplitter.Part) {
        switch part {
        case .reasoning(let text): self = .reasoning(text)
        case .content(let text): self = .content(text)
        }
    }
}

struct EngineResult: Sendable {
    let finish: FinishReason
    let timings: Timings
}

enum EngineError: Error {
    case contextExceeded(prompt: Int, context: Int)
    case badRequest(String)
}

/// The loaded model and the one conversation cache. Requests run one at a time, in arrival order (llama-server
/// with one slot does the same): video work shares the GPU, and two at once would only slow both.
actor Engine {
    private let context: ModelContext
    private let options: ServerOptions
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    /// The last text-only prompt's tokens and the cache as it stood at its end (before the answer), with the model
    /// state that goes with it: the next agent turn continues from here instead of reading the whole conversation
    /// again. Qwen3.5's linear-attention layers can't be rewound, so only an exact prefix is reused.
    private var cachedTokens: [Int] = []
    private var snapshot: [KVCache] = []
    private var snapshotState: LMOutput.State?
    /// Tool calls held to their schemas, as llama-server holds them (ToolCallGrammar); nil leaves them free.
    private let toolGrammar: ToolCallGrammar?

    init(context: ModelContext, options: ServerOptions, toolGrammar: ToolCallGrammar?) {
        self.context = context
        self.options = options
        self.toolGrammar = toolGrammar
    }

    static func load(options: ServerOptions, chatTemplate: String?) async throws -> Engine {
        let directory = URL(fileURLWithPath: options.model, isDirectory: true)
        let context = try await VLMModelFactory.shared.load(
            from: directory, using: TransformersTokenizerLoader(chatTemplate: chatTemplate))
        let grammar: ToolCallGrammar?
        do {
            grammar = try ToolCallGrammar(tokenizer: context.tokenizer)
        } catch {
            FileHandle.standardError.write(Data("[mlx-server] tool calls go unconstrained: \(error)\n".utf8))
            grammar = nil
        }
        return Engine(context: context, options: options, toolGrammar: grammar)
    }

    var toolCallFormat: String { context.configuration.toolCallFormat?.rawValue ?? "json" }

    private func acquire() async {
        if !busy {
            busy = true
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }

    private func release() {
        if waiters.isEmpty {
            busy = false
        } else {
            waiters.removeFirst().resume()
        }
    }

    /// What the request asks the model, as mlx-swift-lm takes it: the chat, the tools (unless the choice is none), the
    /// template's keyword arguments, and the pixel budget per image.
    nonisolated private func userInput(_ request: ChatRequest) throws -> UserInput {
        var kwargs: [String: any Sendable] = [templateMessagesKey: templateMessages(request.messages)]
        for (key, value) in request.templateKwargs { kwargs[key] = value.jinja }
        // Factor of 32 pixels a side per vision token after the merge (Qwen3.5: 16-pixel patches, merged 2 x 2).
        let factor = 32
        let processing = UserInput.Processing(
            minPixels: options.imageMinTokens * factor * factor,
            maxPixels: options.imageMaxTokens * factor * factor)
        let input = UserInput(
            chat: try chatMessages(request.messages),
            processing: processing,
            tools: request.usesTools ? request.tools.map(templateTool) : nil,
            additionalContext: kwargs)
        return input
    }

    /// The prompt a request renders to, as text (llama-server's /apply-template): for checking that both servers
    /// put the same words in front of the model.
    func renderedPrompt(_ request: ChatRequest) async throws -> String {
        await acquire()
        defer { release() }
        let prepared = try await context.processor.prepare(input: try userInput(request))
        let tokens = prepared.text.tokens.reshaped(-1).asArray(Int.self)
        return context.tokenizer.decode(tokenIds: tokens, skipSpecialTokens: false)
    }

    /// Runs one request. `emit` returns false once the client has gone: generation stops there.
    func respond(
        _ request: ChatRequest, emit: @Sendable (EngineEvent) async -> Bool
    ) async throws -> EngineResult {
        await acquire()
        defer { release() }
        let started = Date()

        let prepared = try await context.processor.prepare(input: try userInput(request))
        let preparedMs = Date().timeIntervalSince(started) * 1000
        let promptTokens = prepared.text.tokens.reshaped(-1).asArray(Int.self)
        guard promptTokens.count < options.contextSize else {
            throw EngineError.contextExceeded(prompt: promptTokens.count, context: options.contextSize)
        }
        let media = prepared.image != nil || prepared.video != nil

        var parameters = GenerateParameters(
            maxTokens: min(request.maxTokens ?? options.defaultMaxTokens, options.contextSize - promptTokens.count),
            temperature: Float(request.temperature ?? 0.8),
            topP: Float(request.topP ?? 0.95))
        parameters.topK = request.topK ?? 40
        parameters.minP = 0.05
        parameters.seed = request.seed

        // A frame's request doesn't touch the conversation cache: the agent's next turn still continues it.
        let reused = media ? 0 : PromptReuse.reusable(cached: cachedTokens, prompt: promptTokens)
        let cache: [KVCache]
        let state: LMOutput.State?
        let lmInput: LMInput
        if reused > 0 {
            cache = snapshot.map { $0.copy() }
            state = snapshotState
            let rest = promptTokens[reused...].map { Int32($0) }
            lmInput = LMInput(tokens: MLXArray(rest).expandedDimensions(axis: 0))
        } else {
            cache = try context.model.newCache(parameters: parameters)
            state = nil
            lmInput = prepared
        }

        var components = GenerationComponents()
        var toolCalls: ToolCallState?
        if request.usesTools, let grammar = toolGrammar {
            let thinking = ToolCallTrigger.promptLeavesThinking(
                promptTokens, thinkStart: grammar.thinkStart, thinkEnd: grammar.thinkEnd)
            let trigger = ToolCallTrigger(open: grammar.open, thinkEnd: grammar.thinkEnd, thinking: thinking)
            let watch = ToolCallState(grammar: grammar, tools: grammar.prepare(request.tools), trigger: trigger)
            toolCalls = watch
            components = GenerationComponents(logitProcessorFactory: { ToolCallProcessor(state: watch) })
        }
        // However the answer ends, the grammar's matcher goes back to its start for the next call.
        defer { toolCalls?.finish() }
        let iterator = try TokenIterator(
            input: lmInput, model: context.model, cache: cache, state: state, parameters: parameters,
            components: components)
        if !media {
            snapshot = cache.map { $0.copy() }
            snapshotState = iterator.state
            cachedTokens = promptTokens
        }

        let (stream, task) = generateTask(
            promptTokenCount: lmInput.text.tokens.size,
            modelConfiguration: context.configuration,
            tokenizer: context.tokenizer,
            iterator: iterator,
            tools: request.usesTools ? request.tools.map(parserTool) : nil,
            toolCallPolicy: parameters.toolCallPolicy)

        let schemas = Dictionary(
            request.tools.compactMap { tool in tool["function"]?["name"]?.string.map { ($0, tool) } },
            uniquingKeysWith: { first, _ in first })
        var splitter = ThinkingSplitter(thinking: request.enableThinking ?? true)
        var calls = 0
        var firstAt: Date?
        var info: GenerateCompletionInfo?
        var clientGone = false
        for await generation in stream {
            if firstAt == nil { firstAt = Date() }
            var events: [EngineEvent] = []
            switch generation {
            case .chunk(let text):
                events = splitter.feed(text).map(EngineEvent.init)
            case .toolCall(let call):
                calls += 1
                events = [
                    .toolCall(
                        GeneratedToolCall(
                            id: callId(),
                            name: call.function.name,
                            argumentsJSON: argumentsJSON(call.function.arguments, schema: schemas[call.function.name])))
                ]
            case .rejectedToolCall(let rejected):
                // As llama-server does with a call it can't parse: the text goes back as the answer.
                FileHandle.standardError.write(
                    Data("[mlx-server] tool call not parsed: \(rejected.reason.rawValue)\n".utf8))
                events = splitter.feed(rejected.rawTextPreview).map(EngineEvent.init)
            case .info(let completion):
                info = completion
            }
            for event in events where !(await emit(event)) {
                clientGone = true
                break
            }
            if clientGone { break }
        }
        if clientGone { task.cancel() }
        await task.value
        for part in splitter.finish() { _ = await emit(EngineEvent(part)) }

        let end = Date()
        // MLX's own clock where it gave one (the prefill to the first token, then the decode), plus the template
        // and image preparation before it.
        let promptMs = preparedMs + (info.map { $0.promptTime * 1000 } ?? (firstAt ?? end).timeIntervalSince(started) * 1000)
        let generateMs = info.map { $0.generateTime * 1000 } ?? end.timeIntervalSince(firstAt ?? end) * 1000
        let timings = Timings(
            cachedTokens: reused, promptTokens: promptTokens.count - reused, promptMs: promptMs,
            generatedTokens: info?.generationTokenCount ?? 0, generateMs: generateMs)
        let finish: FinishReason =
            calls > 0 ? .toolCalls : (info?.stopReason == .length ? .length : .stop)
        // Freed buffers past the cache limit go back to the system between requests.
        Memory.clearCache()
        return EngineResult(finish: finish, timings: timings)
    }

    private func callId() -> String {
        let alphabet = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        return String((0..<32).map { _ in alphabet.randomElement()! })
    }
}
