// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Status and headers of one response; header names are lowercased.
public struct HttpHead: Sendable, Equatable {
    public let status: Int
    public let headers: [String: String]

    public init(status: Int, headers: [String: String]) {
        self.status = status
        self.headers = headers
    }

    var isEventStream: Bool { headers["content-type"]?.lowercased().hasPrefix("text/event-stream") == true }
}

public enum HttpTransportError: Error, Equatable {
    /// Nothing listens on the port (Taalcut not running, or External agents off).
    case unreachable
    case failed(String)
}

/// One POST whose response body arrives line by line, as it is received (a held tools/call streams progress).
public protocol HttpTransport: Sendable {
    func post(
        _ url: URL,
        headers: [String: String],
        body: Data,
        isolation: isolated (any Actor)?,
        onHead: (HttpHead) async -> Void,
        onLine: (String) async -> Void
    ) async throws
}

/// URLSession, with no proxy, cache or cookies: the only peer is 127.0.0.1.
public final class URLSessionTransport: HttpTransport {
    private let session: URLSession

    public init(idleTimeoutSeconds: TimeInterval = 120) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = idleTimeoutSeconds
        configuration.timeoutIntervalForResource = 600
        session = URLSession(configuration: configuration)
    }

    public func post(
        _ url: URL,
        headers: [String: String],
        body: Data,
        isolation: isolated (any Actor)?,
        onHead: (HttpHead) async -> Void,
        onLine: (String) async -> Void
    ) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = body
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch let error as URLError where Self.unreachableCodes.contains(error.code) {
            throw HttpTransportError.unreachable
        } catch {
            throw HttpTransportError.failed(String(describing: error))
        }
        guard let http = response as? HTTPURLResponse else { throw HttpTransportError.failed("not an HTTP response") }
        var lowered: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
            if let name = key as? String, let text = value as? String { lowered[name.lowercased()] = text }
        }
        await onHead(HttpHead(status: http.statusCode, headers: lowered))
        var line: [UInt8] = []
        do {
            for try await byte in bytes {
                if byte == 0x0A {
                    await onLine(Self.text(line))
                    line.removeAll(keepingCapacity: true)
                } else if byte != 0x0D {
                    line.append(byte)
                }
            }
        } catch {
            throw HttpTransportError.failed(String(describing: error))
        }
        if !line.isEmpty { await onLine(Self.text(line)) }
    }

    private static let unreachableCodes: Set<URLError.Code> = [
        .cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .notConnectedToInternet,
    ]

    private static func text(_ bytes: [UInt8]) -> String {
        String(decoding: bytes, as: UTF8.self)
    }
}
