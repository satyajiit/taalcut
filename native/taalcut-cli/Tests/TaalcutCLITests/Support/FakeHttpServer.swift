// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Network

/// One request as the fake server received it; header names lowercased.
struct RecordedRequest: Sendable {
    let method: String
    let path: String
    let headers: [String: String]
    let body: String
}

/// What the fake server sends back. `gate` pauses between body parts until the test opens it.
struct ScriptedResponse: Sendable {
    enum Part: Sendable {
        case text(String)
        case gate(@Sendable () async -> Void)
    }

    var status = 200
    var headers: [String: String] = ["Content-Type": "application/json"]
    var parts: [Part] = []

    static func json(_ body: String, status: Int = 200, headers: [String: String] = [:]) -> ScriptedResponse {
        ScriptedResponse(status: status, headers: ["Content-Type": "application/json"].merging(headers) { $1 }, parts: [.text(body)])
    }

    static func events(_ parts: [Part]) -> ScriptedResponse {
        ScriptedResponse(status: 200, headers: ["Content-Type": "text/event-stream"], parts: parts)
    }

    static func empty(status: Int) -> ScriptedResponse {
        ScriptedResponse(status: status, headers: [:], parts: [])
    }
}

/// A minimal HTTP/1.1 server on 127.0.0.1 for the shim's tests: reads one request per connection (by
/// Content-Length), answers with the script and closes, so the body ends at the close.
final class FakeHttpServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "taalcut-cli.fake-http")
    private let lock = NSLock()
    private var recorded: [RecordedRequest] = []
    private let respond: @Sendable (RecordedRequest) -> ScriptedResponse

    init(respond: @escaping @Sendable (RecordedRequest) -> ScriptedResponse) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
        self.respond = respond
    }

    var port: Int { Int(listener.port?.rawValue ?? 0) }
    var url: URL { URL(string: "http://127.0.0.1:\(port)/mcp")! }

    var requests: [RecordedRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func start() async throws {
        let ready = AsyncStream<Bool> { continuation in
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready: continuation.yield(true)
                case .failed, .cancelled: continuation.yield(false)
                default: break
                }
            }
        }
        listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
        listener.start(queue: queue)
        for await isReady in ready {
            guard isReady else { throw URLError(.cannotConnectToHost) }
            return
        }
    }

    func stop() {
        listener.cancel()
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if let request = Self.parse(buffer) {
                self.lock.lock()
                self.recorded.append(request)
                self.lock.unlock()
                let response = self.respond(request)
                Task { await self.send(response, on: connection) }
            } else if isComplete || error != nil {
                connection.cancel()
            } else {
                self.receive(connection, buffer: buffer)
            }
        }
    }

    private func send(_ response: ScriptedResponse, on connection: NWConnection) async {
        var head = "HTTP/1.1 \(response.status) Scripted\r\n"
        for (name, value) in response.headers { head += "\(name): \(value)\r\n" }
        head += "Connection: close\r\n\r\n"
        await write(Data(head.utf8), on: connection)
        for part in response.parts {
            switch part {
            case .text(let text): await write(Data(text.utf8), on: connection)
            case .gate(let wait): await wait()
            }
        }
        connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func write(_ data: Data, on connection: NWConnection) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            connection.send(content: data, completion: .contentProcessed { _ in continuation.resume() })
        }
    }

    /// A whole request (headers and Content-Length bytes of body), or nil while more is needed.
    static func parse(_ buffer: Data) -> RecordedRequest? {
        guard let split = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let headText = String(decoding: buffer[..<split.lowerBound], as: UTF8.self)
        var lines = headText.components(separatedBy: "\r\n")
        let requestLine = lines.removeFirst().split(separator: " ")
        var headers: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        let length = Int(headers["content-length"] ?? "0") ?? 0
        let body = buffer[split.upperBound...]
        guard body.count >= length else { return nil }
        return RecordedRequest(
            method: requestLine.first.map(String.init) ?? "",
            path: requestLine.dropFirst().first.map(String.init) ?? "",
            headers: headers,
            body: String(decoding: body.prefix(length), as: UTF8.self)
        )
    }
}

/// A one-shot latch a scripted response waits on.
actor Gate {
    private var open = false

    func wait() async {
        while !open { try? await Task.sleep(nanoseconds: 5_000_000) }
    }

    func release() { open = true }
}

/// A port nothing listens on (bound, read and closed again).
func closedLoopbackPort() -> Int {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(fd) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    _ = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) }
    }
    return Int(UInt16(bigEndian: address.sin_port))
}
