// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// `computeUnits` of a `shots.prepare` or `shots.windows` request: one of `ShotsUnits`, default `cpuAndGPU`.
func shotsUnitsParam(_ params: JSONValue) -> Result<ShotsUnits, HelperFailure> {
    guard let object = params.object else { return .failure(.badRequest("params must be an object")) }
    guard let value = object["computeUnits"] else { return .success(.standard) }
    guard let name = value.string, let units = ShotsUnits(rawValue: name) else {
        let names = ShotsUnits.allCases.map(\.rawValue).joined(separator: ", ")
        return .failure(.badRequest("computeUnits is one of \(names)"))
    }
    return .success(units)
}

/// `shots.windows` params: `{ computeUnits?, count, path }`. `path` is a raw file inside an allowed root holding
/// `count` windows back to back, each 100 rgb24 frames of 48×27 (`ShotsWindow.bytes`), at most `shotsRequestLimit`.
/// A file rather than base64 in the line: reading a 518 KB request line took this process 19 ms, a third more than
/// the window's prediction; the file takes well under a millisecond.
struct ShotsWindowsRequest: Sendable {
    let units: ShotsUnits
    let count: Int
    /// The file as the client named it (inside an allowed root once resolved); `frames()` opens this name itself.
    let url: URL

    static func parse(_ params: JSONValue, confinement: PathConfinement) -> Result<ShotsWindowsRequest, HelperFailure> {
        let units: ShotsUnits
        switch shotsUnitsParam(params) {
        case .success(let value): units = value
        case .failure(let failure): return .failure(failure)
        }
        guard let count = whole(params.object?["count"]), (1...shotsRequestLimit).contains(count) else {
            return .failure(.badRequest("count must be 1 to \(shotsRequestLimit) windows"))
        }
        guard let path = params.object?["path"]?.string else { return .failure(.badRequest("path must be a string")) }
        switch confinement.resolve(path) {
        case .failure(let failure): return .failure(failure)
        case .success:
            let named = URL(fileURLWithPath: path).standardizedFileURL
            return .success(ShotsWindowsRequest(units: units, count: count, url: named))
        }
    }

    /// The windows' bytes (IX2-F13). The named file is opened without following a link and without blocking (a FIFO
    /// opens at once), and must be a regular file of exactly `count` windows before a byte is read; then exactly that
    /// many are read. A link, a directory, a FIFO, an unreadable file or one of another length is a bad request, so
    /// a huge file or a FIFO someone left in the allowed root costs nothing.
    func frames() -> Result<Data, HelperFailure> {
        let name = url.lastPathComponent
        let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard fd >= 0 else {
            let reason = errno == ELOOP ? "is a symbolic link" : "is unreadable (errno \(errno))"
            return .failure(.badRequest("\(name) \(reason)"))
        }
        defer { Darwin.close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else {
            return .failure(.badRequest("\(name) is not a regular file"))
        }
        let expected = count * ShotsWindow.bytes
        guard info.st_size == off_t(expected) else {
            return .failure(.badRequest(
                "\(name) holds \(info.st_size) bytes, not \(count) windows of \(ShotsWindow.bytes)"))
        }
        var data = Data(count: expected)
        let got = data.withUnsafeMutableBytes { raw in readFully(fd, raw.baseAddress, expected) }
        guard got == expected else { return .failure(.badRequest("\(name) ended after \(got) of \(expected) bytes")) }
        return .success(data)
    }
}

/// Reads up to `count` bytes into `buffer`, past interrupted reads; how many it read (fewer at the end of the file or
/// on an error).
private func readFully(_ fd: Int32, _ buffer: UnsafeMutableRawPointer?, _ count: Int) -> Int {
    guard let buffer else { return 0 }
    var offset = 0
    while offset < count {
        let read = Darwin.read(fd, buffer + offset, count - offset)
        if read > 0 {
            offset += read
        } else if read < 0 && errno == EINTR {
            continue
        } else {
            break
        }
    }
    return offset
}

/// Window `index` of `frames`.
func shotsWindow(_ frames: Data, _ index: Int) -> Data {
    let start = frames.startIndex + index * ShotsWindow.bytes
    return frames.subdata(in: start..<(start + ShotsWindow.bytes))
}
