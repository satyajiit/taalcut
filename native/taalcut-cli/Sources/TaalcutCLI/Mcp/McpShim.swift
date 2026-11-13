// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// `taalcut mcp`: a transparent pipe from a stdio MCP client to Taalcut's loopback HTTP server. One POST per
/// stdin line; every JSON response and SSE event becomes one stdout line. Messages run concurrently, so a
/// cancellation can reach the server while a call is held for approval.
actor McpShim {
    private let token: String
    private let locator: EndpointLocator
    private let transport: HttpTransport
    private let sink: LineSink
    private let log: DiagnosticLog
    private var legacy = LegacySession()

    init(token: String, locator: EndpointLocator, transport: HttpTransport, sink: LineSink, log: DiagnosticLog) {
        self.token = token
        self.locator = locator
        self.transport = transport
        self.sink = sink
        self.log = log
    }

    /// Forwards every line of `input` and returns once each has its answer.
    func run<Input: AsyncSequence & Sendable>(_ input: Input) async where Input.Element == String {
        await withTaskGroup(of: Void.self) { group in
            do {
                for try await line in input {
                    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                    if trimmed.isEmpty { continue }
                    group.addTask { await self.forward(trimmed) }
                }
            } catch {
                log.write("stdin failed: \(error)")
            }
        }
    }

    func forward(_ line: String) async {
        let message = JsonRpcMessage.parse(line)
        if message?.isInitialize == true { legacy = LegacySession() }
        let headers = HeaderPlan.headers(for: message, token: token, legacy: legacy)
        guard let url = await reachableURL() else { return await answerOff(message) }
        do {
            try await post(url, line: line, headers: headers, message: message)
        } catch HttpTransportError.unreachable {
            // Taalcut quit, or External agents were just turned off: open it once, then try again once.
            guard let retry = await locator.openAppAndWait() else { return await answerOff(message) }
            do {
                try await post(retry, line: line, headers: headers, message: message)
            } catch {
                log.write("\(message?.method ?? "message") failed: \(error)")
                await answerOff(message)
            }
        } catch {
            log.write("\(message?.method ?? "message") failed: \(error)")
            if let id = message?.idJSON, message?.isRequest == true {
                await sink.emit(ShimReply.error(id: id, code: ShimReply.internalErrorCode, message: "Taalcut didn't answer."))
            }
        }
    }

    private func reachableURL() async -> URL? {
        if let url = await locator.current() { return url }
        return await locator.openAppAndWait()
    }

    private func answerOff(_ message: JsonRpcMessage?) async {
        guard let id = message?.idJSON, message?.isRequest == true else { return }
        await sink.emit(ShimReply.error(id: id, code: ShimReply.offCode, message: ShimReply.offMessage))
    }

    private func post(_ url: URL, line: String, headers: [String: String], message: JsonRpcMessage?) async throws {
        var reply = ReplyCollector(message: message)
        try await transport.post(
            url,
            headers: headers,
            body: Data(line.utf8),
            isolation: self,
            onHead: { head in reply.head = head },
            onLine: { text in
                if let out = reply.take(text) { await self.deliver(out, message: message) }
            }
        )
        for out in reply.finish() { await deliver(out, message: message) }
        if let head = reply.head { noteSession(head, message: message) }
    }

    private func deliver(_ line: String, message: JsonRpcMessage?) async {
        if message?.isInitialize == true, let version = Self.negotiatedVersion(line) {
            legacy.negotiatedVersion = version
        }
        await sink.emit(line)
    }

    private func noteSession(_ head: HttpHead, message: JsonRpcMessage?) {
        if message?.isInitialize == true, let session = head.headers["mcp-session-id"] {
            legacy.sessionId = session
        } else if head.status == 404, legacy.sessionId != nil {
            // The server ended the protocol session (revoked, or Taalcut restarted): the client must initialize again.
            log.write("the server ended protocol session \(legacy.sessionId ?? "")")
            legacy = LegacySession()
        }
    }

    private static func negotiatedVersion(_ line: String) -> String? {
        guard let data = line.data(using: .utf8),
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let result = object["result"] as? [String: Any]
        else { return nil }
        return result["protocolVersion"] as? String
    }
}
