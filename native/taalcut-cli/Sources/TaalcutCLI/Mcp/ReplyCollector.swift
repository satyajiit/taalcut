// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Turns one HTTP response into the stdout lines the client gets: each SSE event as it arrives, a JSON body
/// as one line at the end, and the shim's own error for a 401 or an answer that isn't JSON-RPC.
struct ReplyCollector {
    let message: JsonRpcMessage?
    var head: HttpHead?
    private var sse = SseDecoder()
    private var body: [String] = []

    init(message: JsonRpcMessage?) {
        self.message = message
    }

    /// A line to write now (an SSE event that just ended), if any.
    mutating func take(_ line: String) -> String? {
        guard let head, head.status / 100 == 2, head.isEventStream else {
            body.append(line)
            return nil
        }
        return sse.push(line).map(ShimReply.oneLine)
    }

    /// What is left once the body has ended.
    mutating func finish() -> [String] {
        guard let head else { return [] }
        if head.status == 401 { return requestError(code: ShimReply.revokedCode, message: ShimReply.revokedMessage) }
        if head.status / 100 == 2 {
            if head.isEventStream { return sse.flush().map { [ShimReply.oneLine($0)] } ?? [] }
            let text = ShimReply.oneLine(body.joined(separator: "\n"))
            return text.isEmpty ? [] : [text]
        }
        return failure(status: head.status)
    }

    /// A non-2xx answer: the server's JSON-RPC error under the request's id, else a plain internal error.
    private func failure(status: Int) -> [String] {
        guard let id = message?.idJSON, message?.isRequest == true else { return [] }
        let text = ShimReply.oneLine(body.joined(separator: "\n"))
        if let object = JsonText.object(text), object["jsonrpc"] as? String == "2.0" {
            if object["id"] != nil, !(object["id"] is NSNull) { return [text] }
            if let error = object["error"], let errorText = JsonText.serialize(error) {
                return [ShimReply.error(id: id, errorObject: errorText)]
            }
        }
        return [ShimReply.error(id: id, code: ShimReply.internalErrorCode, message: "Taalcut answered HTTP \(status).")]
    }

    private func requestError(code: Int, message text: String) -> [String] {
        guard let id = message?.idJSON, message?.isRequest == true else { return [] }
        return [ShimReply.error(id: id, code: code, message: text)]
    }
}
