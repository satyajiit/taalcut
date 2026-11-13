// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// One HTTP/1.1 request, read whole: the app sends small JSON bodies (a frame as base64 is the largest).
public struct HTTPRequest: Sendable, Equatable {
    public let method: String
    /// The path without its query.
    public let path: String
    /// Header names lowercased.
    public let headers: [String: String]
    public let body: Data

    public init(method: String, path: String, headers: [String: String], body: Data) {
        self.method = method
        self.path = path
        self.headers = headers
        self.body = body
    }

    /// The bearer token of the Authorization header, if any.
    public var bearerToken: String? {
        guard let value = headers["authorization"] else { return nil }
        let parts = value.split(separator: " ", maxSplits: 1)
        guard parts.count == 2, parts[0].lowercased() == "bearer" else { return nil }
        return String(parts[1]).trimmingCharacters(in: .whitespaces)
    }
}

public enum HTTPParseResult: Equatable {
    /// More bytes are needed.
    case incomplete
    case request(HTTPRequest, consumed: Int)
    /// The bytes aren't a request this server takes; answer 400 (or 413) and close.
    case invalid(status: Int, reason: String)
}

/// Parses a request from the bytes received so far. Bodies need a Content-Length (no chunked uploads: the app's
/// fetch sends a length for a JSON body).
public enum HTTPParser {
    /// The largest body taken: a long agent conversation with frames stays far below it.
    public static let maxBodyBytes = 64 * 1024 * 1024
    public static let maxHeaderBytes = 64 * 1024

    public static func parse(_ buffer: Data) -> HTTPParseResult {
        let separator = Data("\r\n\r\n".utf8)
        guard let end = buffer.range(of: separator) else {
            return buffer.count > maxHeaderBytes ? .invalid(status: 431, reason: "headers too large") : .incomplete
        }
        guard let head = String(data: buffer[buffer.startIndex..<end.lowerBound], encoding: .utf8) else {
            return .invalid(status: 400, reason: "headers are not UTF-8")
        }
        var lines = head.components(separatedBy: "\r\n")
        let requestLine = lines.removeFirst().split(separator: " ")
        guard requestLine.count == 3, requestLine[2].hasPrefix("HTTP/1.") else {
            return .invalid(status: 400, reason: "bad request line")
        }
        var headers: [String: String] = [:]
        for line in lines where !line.isEmpty {
            guard let colon = line.firstIndex(of: ":") else { return .invalid(status: 400, reason: "bad header") }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[name] = value
        }
        if let encoding = headers["transfer-encoding"], encoding.lowercased() != "identity" {
            return .invalid(status: 400, reason: "chunked request bodies are not supported")
        }
        let length = Int(headers["content-length"] ?? "0") ?? -1
        guard length >= 0 else { return .invalid(status: 400, reason: "bad content-length") }
        guard length <= maxBodyBytes else { return .invalid(status: 413, reason: "body too large") }
        let bodyStart = end.upperBound
        guard buffer.count - (bodyStart - buffer.startIndex) >= length else { return .incomplete }
        let body = buffer[bodyStart..<(bodyStart + length)]
        let target = String(requestLine[1])
        let path = target.split(separator: "?", maxSplits: 1).first.map(String.init) ?? target
        let request = HTTPRequest(method: String(requestLine[0]), path: path, headers: headers, body: Data(body))
        return .request(request, consumed: bodyStart - buffer.startIndex + length)
    }
}

/// Response heads and bodies. Every response closes its connection, so a stream ends where the chunks end.
public enum HTTPResponse {
    public static func reason(_ status: Int) -> String {
        switch status {
        case 200: "OK"
        case 400: "Bad Request"
        case 401: "Unauthorized"
        case 404: "Not Found"
        case 405: "Method Not Allowed"
        case 413: "Payload Too Large"
        case 431: "Request Header Fields Too Large"
        case 500: "Internal Server Error"
        case 503: "Service Unavailable"
        default: "Status"
        }
    }

    /// A whole JSON response.
    public static func json(status: Int, body: Data) -> Data {
        var head = "HTTP/1.1 \(status) \(reason(status))\r\n"
        head += "Content-Type: application/json; charset=utf-8\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        return Data(head.utf8) + body
    }

    /// The head of a server-sent event stream, sent chunked.
    public static func eventStreamHead() -> Data {
        var head = "HTTP/1.1 200 OK\r\n"
        head += "Content-Type: text/event-stream; charset=utf-8\r\n"
        head += "Cache-Control: no-cache\r\n"
        head += "Transfer-Encoding: chunked\r\n"
        head += "Connection: close\r\n\r\n"
        return Data(head.utf8)
    }

    /// One chunk of a chunked body.
    public static func chunk(_ data: Data) -> Data {
        guard !data.isEmpty else { return Data() }
        return Data(String(data.count, radix: 16).utf8) + Data("\r\n".utf8) + data + Data("\r\n".utf8)
    }

    /// The end of a chunked body.
    public static let lastChunk = Data("0\r\n\r\n".utf8)

    /// llama-server's error body: `{"error":{"code","message","type"}}` plus any extra fields.
    public static func errorBody(
        status: Int, message: String, type: String, extra: [String: Any] = [:]
    ) -> Data {
        var error: [String: Any] = ["code": status, "message": message, "type": type]
        for (key, value) in extra { error[key] = value }
        return (try? JSONSerialization.data(withJSONObject: ["error": error], options: [.sortedKeys])) ?? Data()
    }
}
