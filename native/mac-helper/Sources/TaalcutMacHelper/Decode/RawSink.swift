// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// An output the pass writes raw frames to: a regular file (created or truncated), or a FIFO the caller's reader
/// opened. Writes are plain write(2): the process ignores SIGPIPE, so a reader that went away is EPIPE here and
/// fails the request (`outputClosed`) instead of killing the process with a session open.
final class RawSink {
    /// How long a FIFO may wait for its reader to open it.
    static let readerWaitSeconds: Double = 10

    private var fd: Int32
    private let name: String

    private init(fd: Int32, name: String) {
        self.fd = fd
        self.name = name
    }

    static func open(_ url: URL, cancel: PassCancel) -> Result<RawSink, PassFailure> {
        let path = url.path
        var info = stat()
        let exists = lstat(path, &info) == 0
        if exists && (info.st_mode & S_IFMT) == S_IFIFO {
            return openFifo(path, cancel: cancel).map { RawSink(fd: $0, name: url.lastPathComponent) }
        }
        if exists && (info.st_mode & S_IFMT) != S_IFREG {
            return .failure(.outputClosed("\(url.lastPathComponent) is neither a file nor a FIFO"))
        }
        let fd = Darwin.open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { return .failure(.outputClosed("open \(url.lastPathComponent): errno \(errno)")) }
        return .success(RawSink(fd: fd, name: url.lastPathComponent))
    }

    /// A FIFO opened for writing without blocking: ENXIO until the reader opens its end. Waits for the reader, a
    /// cancel or the time limit, then switches the descriptor back to blocking writes (the reader paces the pass).
    private static func openFifo(_ path: String, cancel: PassCancel) -> Result<Int32, PassFailure> {
        let deadline = Date().addingTimeInterval(readerWaitSeconds)
        while true {
            let fd = Darwin.open(path, O_WRONLY | O_NONBLOCK | O_CLOEXEC)
            if fd >= 0 {
                let flags = fcntl(fd, F_GETFL)
                _ = fcntl(fd, F_SETFL, flags & ~O_NONBLOCK)
                return .success(fd)
            }
            guard errno == ENXIO else { return .failure(.outputClosed("open FIFO: errno \(errno)")) }
            if cancel.isCancelled { return .failure(.cancelled) }
            if Date() > deadline { return .failure(.outputClosed("no reader opened the FIFO")) }
            usleep(5_000)
        }
    }

    func write(_ bytes: [UInt8]) -> Result<Void, PassFailure> {
        guard fd >= 0 else { return .failure(.outputClosed("\(name) is closed")) }
        return bytes.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return .success(()) }
            var offset = 0
            while offset < raw.count {
                let wrote = Darwin.write(fd, base + offset, raw.count - offset)
                if wrote > 0 {
                    offset += wrote
                } else if wrote < 0 && errno == EINTR {
                    continue
                } else {
                    return .failure(.outputClosed("write \(name): errno \(errno)"))
                }
            }
            return .success(())
        }
    }

    func close() {
        if fd >= 0 { Darwin.close(fd) }
        fd = -1
    }

    deinit {
        close()
    }
}
