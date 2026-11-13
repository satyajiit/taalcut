// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import MLXServerProtocol

@Suite struct HTTPParserTests {
    @Test func parsesAPostWithItsBody() throws {
        let body = #"{"a":1}"#
        let raw = "POST /v1/chat/completions?x=1 HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer k-1\r\n"
            + "Content-Length: \(body.utf8.count)\r\n\r\n\(body)"
        guard case .request(let request, let consumed) = HTTPParser.parse(Data(raw.utf8)) else {
            Issue.record("not parsed")
            return
        }
        #expect(request.method == "POST")
        #expect(request.path == "/v1/chat/completions")
        #expect(request.bearerToken == "k-1")
        #expect(String(data: request.body, encoding: .utf8) == body)
        #expect(consumed == raw.utf8.count)
    }

    @Test func waitsForTheWholeBody() {
        let raw = "POST / HTTP/1.1\r\nContent-Length: 10\r\n\r\n12345"
        #expect(HTTPParser.parse(Data(raw.utf8)) == .incomplete)
        #expect(HTTPParser.parse(Data("GET /health HTTP/1.1\r\n".utf8)) == .incomplete)
    }

    @Test func refusesChunkedUploadsAndHugeBodies() {
        let chunked = "POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"
        #expect(HTTPParser.parse(Data(chunked.utf8)) == .invalid(status: 400, reason: "chunked request bodies are not supported"))
        let huge = "POST / HTTP/1.1\r\nContent-Length: \(HTTPParser.maxBodyBytes + 1)\r\n\r\n"
        #expect(HTTPParser.parse(Data(huge.utf8)) == .invalid(status: 413, reason: "body too large"))
    }

    @Test func chunksAStream() {
        let chunk = HTTPResponse.chunk(Data("data: x\n\n".utf8))
        #expect(String(data: chunk, encoding: .utf8) == "9\r\ndata: x\n\n\r\n")
        #expect(HTTPResponse.chunk(Data()).isEmpty)
    }
}

@Suite struct JSONValueTests {
    @Test func keepsKeyOrderAndRoundTrips() throws {
        let text = #"{"type":"function","function":{"name":"f","description":"d \"q\" é","parameters":{"b":1,"a":[true,null,2.5]}}}"#
        let value = try JSONValue.parse(text)
        #expect(value.serialized() == text.replacingOccurrences(of: "é", with: "é"))
        #expect(value["function"]?["parameters"]?.objectPairs?.map(\.0) == ["b", "a"])
    }

    @Test func decodesEscapesAndSurrogates() throws {
        let value = try JSONValue.parse(#"["é\n", "😀"]"#)
        #expect(value.array?.compactMap(\.string) == ["é\n", "😀"])
    }

    @Test func refusesTrailingGarbage() {
        #expect(throws: JSONParseError.self) { try JSONValue.parse("{} x") }
    }
}

@Suite struct ChatRequestTests {
    @Test func decodesWhatPiAiSends() throws {
        let body = """
            {"model":"qwen3.5-9b","stream":true,"stream_options":{"include_usage":true},"max_completion_tokens":512,
             "temperature":0,"chat_template_kwargs":{"enable_thinking":false},
             "messages":[
               {"role":"developer","content":"be brief"},
               {"role":"user","content":[{"type":"text","text":"what is this?"},
                 {"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgo="}}]},
               {"role":"assistant","content":"","reasoning_content":"","tool_calls":[{"id":"c1","type":"function",
                 "function":{"name":"templates_breakdown","arguments":"{\\"projectId\\":\\"p\\",\\"n\\":2}"}}]},
               {"role":"tool","tool_call_id":"c1","content":"ok"}],
             "tools":[{"type":"function","function":{"name":"templates_breakdown","parameters":{"type":"object"}}}]}
            """
        let request = try ChatRequest.decode(Data(body.utf8))
        #expect(request.stream)
        #expect(request.includeUsage)
        #expect(request.maxTokens == 512)
        #expect(request.temperature == 0)
        #expect(request.enableThinking == false)
        #expect(request.messages.map(\.role) == [.system, .user, .assistant, .tool])
        #expect(request.messages[1].images.first?.mediaType == "image/png")
        #expect(request.messages[1].text == "what is this?")
        // The template writes the parts in the order sent: the question, then its frame.
        #expect(request.messages[1].parts == [.text("what is this?"), .image])
        #expect(request.messages[0].parts == nil)
        let call = try #require(request.messages[2].toolCalls.first)
        #expect(call.name == "templates_breakdown")
        #expect(call.arguments.serialized() == #"{"projectId":"p","n":2}"#)
        #expect(request.messages[2].reasoning == nil)
        #expect(request.messages[3].toolCallId == "c1")
        #expect(request.tools.count == 1)
    }

    @Test func refusesRemoteImagesAndUnknownRoles() {
        let remote = #"{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"https://x/y.jpg"}}]}]}"#
        #expect(throws: ChatRequestError.self) { try ChatRequest.decode(Data(remote.utf8)) }
        let role = #"{"messages":[{"role":"wizard","content":"x"}]}"#
        #expect(throws: ChatRequestError.self) { try ChatRequest.decode(Data(role.utf8)) }
        #expect(throws: ChatRequestError.self) { try ChatRequest.decode(Data("{}".utf8)) }
    }

    @Test func argumentsThatArentAnObjectBecomeEmpty() throws {
        let body = #"{"messages":[{"role":"assistant","content":"","tool_calls":[{"id":"c","function":{"name":"f","arguments":"not json"}}]}]}"#
        let request = try ChatRequest.decode(Data(body.utf8))
        #expect(request.messages[0].toolCalls[0].arguments == .object([]))
    }
}

@Suite struct ChatResponseTests {
    let encoder = ChatResponseEncoder(id: "chatcmpl-1", created: 7, model: "qwen3.5-9b")

    @Test func streamsToolCallsWithTheirIndexThenFinishThenUsage() throws {
        let call = GeneratedToolCall(id: "c1", name: "f", argumentsJSON: #"{"a":1}"#)
        let event = String(data: encoder.toolCallEvent(call, index: 0), encoding: .utf8)!
        #expect(event.hasPrefix("data: {") && event.hasSuffix("}\n\n"))
        let json = try JSONValue.parse(String(event.dropFirst(6)))
        let delta = json["choices"]?.array?.first?["delta"]?["tool_calls"]?.array?.first
        #expect(delta?["index"] == .int(0))
        #expect(delta?["function"]?["arguments"]?.string == #"{"a":1}"#)
        let timings = Timings(cachedTokens: 100, promptTokens: 20, promptMs: 10, generatedTokens: 5, generateMs: 50)
        let finish = try JSONValue.parse(String(String(data: encoder.finishEvent(.toolCalls, timings: timings), encoding: .utf8)!.dropFirst(6)))
        #expect(finish["choices"]?.array?.first?["finish_reason"]?.string == "tool_calls")
        // 20 tokens in 10 ms; a whole number is written without a fraction.
        #expect([JSONValue.int(2000), .double(2000)].contains(finish["timings"]?["prompt_per_second"]))
        let usage = try JSONValue.parse(String(String(data: encoder.usageEvent(timings), encoding: .utf8)!.dropFirst(6)))
        #expect(usage["usage"]?["prompt_tokens"] == .int(120))
        #expect(usage["usage"]?["prompt_tokens_details"]?["cached_tokens"] == .int(100))
        #expect(usage["choices"]?.array?.isEmpty == true)
    }

    @Test func aWholeResponseCarriesTheCalls() throws {
        let timings = Timings(cachedTokens: 0, promptTokens: 3, promptMs: 1, generatedTokens: 2, generateMs: 1)
        let body = encoder.completion(
            content: "", reasoning: "", toolCalls: [GeneratedToolCall(id: "c", name: "f", argumentsJSON: "{}")],
            finish: .toolCalls, timings: timings)
        let json = try JSONValue.parse(body)
        #expect(json["choices"]?.array?.first?["message"]?["tool_calls"]?.array?.count == 1)
        #expect(json["object"]?.string == "chat.completion")
    }
}

@Suite struct ServerOptionsTests {
    @Test func parsesLlamaServerStyleFlags() throws {
        let options = try ServerOptions.parse([
            "--model", "/m", "--alias", "qwen3.5-9b", "--host", "127.0.0.1", "--port", "4100", "--ctx-size", "32768",
        ])
        #expect(options.port == 4100)
        #expect(options.contextSize == 32_768)
        #expect(options.imageMinTokens == 1_024)
    }

    @Test func refusesAnythingButLoopback() {
        #expect(throws: ServerOptions.ParseError.self) {
            try ServerOptions.parse(["--model", "/m", "--alias", "a", "--host", "0.0.0.0"])
        }
        #expect(throws: ServerOptions.ParseError.self) { try ServerOptions.parse(["--model", "/m"]) }
        #expect(throws: ServerOptions.ParseError.self) {
            try ServerOptions.parse(["--model", "/m", "--alias", "a", "--webui", "on"])
        }
    }
}

@Suite struct PromptReuseTests {
    @Test func reusesOnlyAnExactShorterPrefix() {
        #expect(PromptReuse.reusable(cached: [1, 2, 3], prompt: [1, 2, 3, 4, 5]) == 3)
        #expect(PromptReuse.reusable(cached: [1, 2, 9], prompt: [1, 2, 3, 4]) == 0)
        #expect(PromptReuse.reusable(cached: [1, 2, 3], prompt: [1, 2, 3]) == 0)
        #expect(PromptReuse.reusable(cached: [], prompt: [1]) == 0)
    }
}

@Suite struct ThinkingSplitterTests {
    @Test func splitsReasoningFromTheReplyAcrossChunks() {
        var splitter = ThinkingSplitter(thinking: true)
        var parts = splitter.feed("Let me see.</th")
        parts += splitter.feed("ink>\n\nHello")
        parts += splitter.finish()
        #expect(parts == [.reasoning("Let me see."), .content("Hello")])
    }

    @Test func passesTextThroughWithThinkingOff() {
        var splitter = ThinkingSplitter(thinking: false)
        #expect(splitter.feed("Hi") == [.content("Hi")])
        #expect(splitter.finish().isEmpty)
    }
}
