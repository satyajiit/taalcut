// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import MLXServerProtocol
import Network

/// A small HTTP/1.1 server on Network.framework, bound to one loopback address: one request per connection, each
/// response closing it. The app's fetch opens a connection per call; that is all llama-server's clients need too.
final class HTTPServer: @unchecked Sendable {
    typealias Handler = @Sendable (HTTPRequest, ResponseWriter) async -> Void

    private let listener: NWListener
    private let queue = DispatchQueue(label: "taalcut.mlx-server.http")
    private let handler: Handler

    init(host: String, port: Int, handler: @escaping Handler) throws {
        guard let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
            throw ServerOptions.ParseError.usage("bad port \(port)")
        }
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(host), port: nwPort)
        parameters.acceptLocalOnly = true
        // A restart on the port the last process had (still in TIME_WAIT) binds, as llama-server's does.
        parameters.allowLocalEndpointReuse = true
        listener = try NWListener(using: parameters)
        self.handler = handler
    }

    /// Resolves once listening; throws when the port can't be had (the driver then tries another).
    func start() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let once = Once()
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready: once.run { continuation.resume() }
                case .failed(let error): once.run { continuation.resume(throwing: error) }
                case .cancelled: once.run { continuation.resume(throwing: CancellationError()) }
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
            listener.start(queue: queue)
        }
    }

    private func accept(_ connection: NWConnection) {
        let writer = ResponseWriter(connection: connection, queue: queue)
        connection.stateUpdateHandler = { state in
            switch state {
            case .failed, .cancelled: writer.markClosed()
            default: break
            }
        }
        connection.start(queue: queue)
        receive(connection, buffer: Data(), writer: writer)
    }

    private func receive(_ connection: NWConnection, buffer: Data, writer: ResponseWriter) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, complete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            switch HTTPParser.parse(buffer) {
            case .request(let request, _):
                // Watch for the client going away while the answer is being written (an aborted call).
                self.watchClose(connection, writer: writer)
                Task { await self.handler(request, writer) }
            case .invalid(let status, let reason):
                Task {
                    _ = await writer.send(
                        HTTPResponse.json(
                            status: status,
                            body: HTTPResponse.errorBody(status: status, message: reason, type: "invalid_request_error")))
                    writer.close()
                }
            case .incomplete:
                if complete || error != nil {
                    writer.close()
                } else {
                    self.receive(connection, buffer: buffer, writer: writer)
                }
            }
        }
    }

    private func watchClose(_ connection: NWConnection, writer: ResponseWriter) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] _, _, complete, error in
            if complete || error != nil {
                writer.markClosed()
            } else {
                self?.watchClose(connection, writer: writer)
            }
        }
    }
}

/// Writes one response. `send` reports false once the client has gone, so a generation can stop.
final class ResponseWriter: @unchecked Sendable {
    private let connection: NWConnection
    private let queue: DispatchQueue
    private let lock = NSLock()
    private var closed = false

    init(connection: NWConnection, queue: DispatchQueue) {
        self.connection = connection
        self.queue = queue
    }

    var isOpen: Bool { lock.withLock { !closed } }

    func markClosed() { lock.withLock { closed = true } }

    func send(_ data: Data) async -> Bool {
        guard isOpen else { return false }
        if data.isEmpty { return true }
        return await withCheckedContinuation { continuation in
            connection.send(
                content: data,
                completion: .contentProcessed { [weak self] error in
                    if error != nil { self?.markClosed() }
                    continuation.resume(returning: error == nil)
                })
        }
    }

    func close() {
        markClosed()
        connection.send(
            content: nil, contentContext: .finalMessage, isComplete: true,
            completion: .contentProcessed { [connection] _ in connection.cancel() })
    }
}

/// Runs a block at most once (a continuation must not resume twice).
final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func run(_ block: () -> Void) {
        let first = lock.withLock { () -> Bool in
            if done { return false }
            done = true
            return true
        }
        if first { block() }
    }
}
