// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import MLXServerProtocol

/// The model, once it has loaded.
actor ServerState {
    private(set) var engine: Engine?

    func ready(_ engine: Engine) { self.engine = engine }
}

/// llama-server's endpoints, as the app uses them: `GET /health` (no key needed, 503 while loading),
/// `GET /v1/models`, and `POST /v1/chat/completions`, streamed or whole.
struct Routes: Sendable {
    let options: ServerOptions
    let apiKey: String?
    let state: ServerState

    func handle(_ request: HTTPRequest, writer: ResponseWriter) async {
        defer { writer.close() }
        let path = request.path
        if path == "/health" || path == "/v1/health" {
            let loaded = await state.engine != nil
            let body = loaded ? Data(#"{"status":"ok"}"#.utf8) : loadingBody
            _ = await writer.send(HTTPResponse.json(status: loaded ? 200 : 503, body: body))
            return
        }
        if let apiKey, request.bearerToken != apiKey {
            _ = await writer.send(
                HTTPResponse.json(
                    status: 401,
                    body: HTTPResponse.errorBody(
                        status: 401, message: "Invalid API Key", type: "authentication_error")))
            return
        }
        guard let engine = await state.engine else {
            _ = await writer.send(HTTPResponse.json(status: 503, body: loadingBody))
            return
        }
        switch (request.method, path) {
        case ("GET", "/v1/models"), ("GET", "/models"):
            let body: WireJSON = .object([
                ("object", .string("list")),
                ("data", .array([.object([("id", .string(options.alias)), ("object", .string("model")),
                                          ("owned_by", .string("taalcut"))])])),
            ])
            _ = await writer.send(HTTPResponse.json(status: 200, body: Data(body.serialized().utf8)))
        case ("POST", "/v1/chat/completions"), ("POST", "/chat/completions"):
            await complete(request, engine: engine, writer: writer)
        case ("POST", "/apply-template"):
            do {
                let prompt = try await engine.renderedPrompt(try ChatRequest.decode(request.body))
                let body: WireJSON = .object([("prompt", .string(prompt))])
                _ = await writer.send(HTTPResponse.json(status: 200, body: Data(body.serialized().utf8)))
            } catch {
                _ = await writer.send(HTTPResponse.json(status: status(error), body: errorData(error)))
            }
        default:
            _ = await writer.send(
                HTTPResponse.json(
                    status: 404,
                    body: HTTPResponse.errorBody(status: 404, message: "File Not Found", type: "not_found_error")))
        }
    }

    private var loadingBody: Data {
        HTTPResponse.errorBody(status: 503, message: "Loading model", type: "unavailable_error")
    }

    private func complete(_ request: HTTPRequest, engine: Engine, writer: ResponseWriter) async {
        let chat: ChatRequest
        do {
            chat = try ChatRequest.decode(request.body)
        } catch {
            _ = await writer.send(badRequest("\(error)"))
            return
        }
        let encoder = ChatResponseEncoder(
            id: "chatcmpl-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased(),
            created: Int(Date().timeIntervalSince1970), model: options.alias)
        if chat.stream {
            await stream(chat, engine: engine, encoder: encoder, writer: writer)
        } else {
            await whole(chat, engine: engine, encoder: encoder, writer: writer)
        }
    }

    private func stream(
        _ chat: ChatRequest, engine: Engine, encoder: ChatResponseEncoder, writer: ResponseWriter
    ) async {
        let started = Started()
        // The head goes out with the first event, so a request refused before generating gets a plain error.
        let send: @Sendable (Data) async -> Bool = { data in
            if await started.first() {
                guard await writer.send(HTTPResponse.eventStreamHead()) else { return false }
                guard await writer.send(HTTPResponse.chunk(encoder.roleEvent())) else { return false }
            }
            return await writer.send(HTTPResponse.chunk(data))
        }
        let index = Counter()
        do {
            let result = try await engine.respond(chat) { event in
                switch event {
                case .content(let text): return await send(encoder.contentEvent(text))
                case .reasoning(let text): return await send(encoder.reasoningEvent(text))
                case .toolCall(let call): return await send(encoder.toolCallEvent(call, index: await index.next()))
                }
            }
            _ = await send(encoder.finishEvent(result.finish, timings: result.timings))
            if chat.includeUsage { _ = await send(encoder.usageEvent(result.timings)) }
            _ = await send(ChatResponseEncoder.done)
            _ = await writer.send(HTTPResponse.lastChunk)
        } catch {
            if await started.happened() {
                // Mid-stream: the stream ends with an error event, which the client's reader raises.
                let body = errorData(error)
                _ = await writer.send(HTTPResponse.chunk(Data("data: ".utf8) + body + Data("\n\n".utf8)))
                _ = await writer.send(HTTPResponse.lastChunk)
            } else {
                _ = await writer.send(HTTPResponse.json(status: status(error), body: errorData(error)))
            }
        }
    }

    private func whole(
        _ chat: ChatRequest, engine: Engine, encoder: ChatResponseEncoder, writer: ResponseWriter
    ) async {
        let collected = Collected()
        do {
            let result = try await engine.respond(chat) { event in
                await collected.add(event)
                return writer.isOpen
            }
            let (content, reasoning, calls) = await collected.parts()
            let body = encoder.completion(
                content: content, reasoning: reasoning, toolCalls: calls, finish: result.finish,
                timings: result.timings)
            _ = await writer.send(HTTPResponse.json(status: 200, body: body))
        } catch {
            _ = await writer.send(HTTPResponse.json(status: status(error), body: errorData(error)))
        }
    }

    private func badRequest(_ message: String) -> Data {
        HTTPResponse.json(
            status: 400, body: HTTPResponse.errorBody(status: 400, message: message, type: "invalid_request_error"))
    }

    private func status(_ error: Error) -> Int {
        switch error {
        case EngineError.contextExceeded, is ChatRequestError: 400
        default: 500
        }
    }

    private func errorData(_ error: Error) -> Data {
        switch error {
        case EngineError.contextExceeded(let prompt, let context):
            // llama-server's words, which pi-ai reads as a context overflow.
            return HTTPResponse.errorBody(
                status: 400, message: "the request exceeds the available context size, try increasing it",
                type: "exceed_context_size_error", extra: ["n_prompt_tokens": prompt, "n_ctx": context])
        case let error as ChatRequestError:
            return HTTPResponse.errorBody(status: 400, message: error.description, type: "invalid_request_error")
        default:
            return HTTPResponse.errorBody(status: 500, message: "\(error)", type: "server_error")
        }
    }
}

actor Started {
    private var done = false
    func first() -> Bool {
        defer { done = true }
        return !done
    }
    func happened() -> Bool { done }
}

actor Counter {
    private var value = 0
    func next() -> Int {
        defer { value += 1 }
        return value
    }
}

actor Collected {
    private var content = ""
    private var reasoning = ""
    private var calls: [GeneratedToolCall] = []

    func add(_ event: EngineEvent) {
        switch event {
        case .content(let text): content += text
        case .reasoning(let text): reasoning += text
        case .toolCall(let call): calls.append(call)
        }
    }

    func parts() -> (String, String, [GeneratedToolCall]) { (content, reasoning, calls) }
}
