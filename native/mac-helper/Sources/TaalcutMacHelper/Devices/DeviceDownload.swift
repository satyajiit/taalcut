// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CryptoKit
import Foundation
import ImageCaptureCore

struct DownloadPlan: Sendable, Equatable {
    var directory: URL
    var filename: String
    var overwrite: Bool
    var sidecars: Bool
    var deleteAfter: Bool
    var truncateAfter: Bool

    static func make(directory: URL, filename: String) -> DownloadPlan {
        DownloadPlan(
            directory: directory, filename: filename, overwrite: true, sidecars: true, deleteAfter: false, truncateAfter: false)
    }

    var keepsOriginals: Bool { overwrite && sidecars && !deleteAfter && !truncateAfter }

    /// Exactly what `requestDownload` is given: the phone's copy is never deleted or truncated.
    var options: [ICDownloadOption: Any] {
        [
            .downloadsDirectoryURL: directory,
            .saveAsFilename: filename,
            .overwrite: overwrite,
            .sidecarFiles: sidecars,
            .deleteAfterSuccessfulDownload: deleteAfter,
            .truncateAfterSuccessfulDownload: truncateAfter,
        ]
    }
}

/// The last path component of a name the phone supplied, or nil when it can't name a file in a folder.
func leafName(_ name: String) -> String? {
    let leaf = (name as NSString).lastPathComponent
    guard !leaf.isEmpty, leaf != ".", leaf != "..", !leaf.contains("/"), !leaf.contains("\0") else { return nil }
    return leaf
}

/// Where ImageCaptureCore saved a download: its name inside `directory`, or an absolute path that
/// resolves (symlinks included) inside it. Anything else is nil.
func placedFile(_ directory: URL, filename: String) -> URL? {
    let candidate = filename.hasPrefix("/") ? filename : directory.appendingPathComponent(filename).path
    guard case .success(let url) = PathConfinement(roots: [directory.path]).resolve(candidate) else { return nil }
    return url
}

/// A devices warning on stderr. Never a path, file name, serial or device name.
func deviceWarning(_ message: String) {
    FileHandle.standardError.write(Data("devices: \(message)\n".utf8))
}

func shorterLeftover(bytes: Int64?, expected: Int64) -> Bool {
    guard let bytes, expected > 0 else { return false }
    return bytes >= 0 && bytes < expected
}

func ancillaryNames(before: Set<String>, after: Set<String>, primary: String) -> [String] {
    after.subtracting(before).subtracting([primary]).sorted()
}

func sha256Hex(of url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    while true {
        let chunk = try handle.read(upToCount: 1024 * 1024)
        guard let chunk, !chunk.isEmpty else { break }
        hasher.update(data: chunk)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

func fileByteCount(_ url: URL) -> Int64? {
    guard let values = try? url.resourceValues(forKeys: [.fileSizeKey]), let size = values.fileSize else { return nil }
    return Int64(size)
}
