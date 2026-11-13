// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Darwin
import Foundation

enum PumpEvent: Sendable {
    case line(String)
    case oversized
    case tick
    case eof
}

/// Reads stdin on a dispatch source so a blocked read never sits on the
/// cooperative pool. An idle serve loop uses the one-second ticks; it exits
/// only when nothing is in flight.
final class LinePump: @unchecked Sendable {
    let events: AsyncStream<PumpEvent>
    private let continuation: AsyncStream<PumpEvent>.Continuation
    private let source: DispatchSourceRead
    private let timer: DispatchSourceTimer?
    private let queue = DispatchQueue(label: "taalcut.mac-helper.stdio")
    private let fd: Int32
    private var buffer = Data()
    private var skipping = false
    private var finished = false

    init(fileDescriptor: Int32, idleTicks: Bool) {
        fd = fileDescriptor
        let flags = fcntl(fd, F_GETFL)
        if flags >= 0 { _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK) }
        var built: AsyncStream<PumpEvent>.Continuation!
        events = AsyncStream { built = $0 }
        continuation = built
        source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        if idleTicks {
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + 1, repeating: 1)
            timer.setEventHandler { [continuation] in continuation.yield(.tick) }
            self.timer = timer
            timer.resume()
        } else {
            timer = nil
        }
        source.setEventHandler { [weak self] in self?.readAvailable() }
        source.resume()
    }

    private func readAvailable() {
        var chunk = [UInt8](repeating: 0, count: 16 * 1024)
        while !finished {
            let count = Darwin.read(fd, &chunk, chunk.count)
            if count > 0 {
                consume(chunk[..<count])
                continue
            }
            if count == 0 {
                finishEof()
                return
            }
            if errno == EINTR { continue }
            if errno == EAGAIN || errno == EWOULDBLOCK { return }
            finishEof()
            return
        }
    }

    private func consume(_ bytes: ArraySlice<UInt8>) {
        for byte in bytes {
            if skipping {
                if byte == 0x0A { skipping = false }
                continue
            }
            if byte == 0x0A {
                emitBuffer()
                continue
            }
            buffer.append(byte)
            if buffer.count > BuildStamp.maxLineBytes {
                buffer.removeAll(keepingCapacity: true)
                skipping = true
                continuation.yield(.oversized)
            }
        }
    }

    private func emitBuffer() {
        let text = String(decoding: buffer, as: UTF8.self)
        buffer.removeAll(keepingCapacity: true)
        continuation.yield(.line(text))
    }

    private func finishEof() {
        guard !finished else { return }
        finished = true
        if !skipping, !buffer.isEmpty { emitBuffer() }
        continuation.yield(.eof)
        continuation.finish()
        source.cancel()
        timer?.cancel()
    }
}

/// One `write(2)` of each JSON line, serialised. Stdout is the protocol.
final class LineWriter: @unchecked Sendable {
    private let lock = NSLock()
    private let fd: Int32

    init(fileDescriptor: Int32 = STDOUT_FILENO) {
        fd = fileDescriptor
    }

    func write(_ value: JSONValue) {
        var data = Data((value.line() + "\n").utf8)
        lock.lock()
        defer { lock.unlock() }
        data.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            var offset = 0
            while offset < raw.count {
                let wrote = Darwin.write(fd, base + offset, raw.count - offset)
                if wrote > 0 {
                    offset += wrote
                } else if wrote < 0 && errno == EINTR {
                    continue
                } else {
                    return
                }
            }
        }
    }
}
