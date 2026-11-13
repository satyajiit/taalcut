// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreVideo
import Foundation

@testable import TaalcutMacHelper

/// A scratch folder (real path: the helper resolves symlinks, /var is /private/var), removed when dropped.
final class DecodeScratch {
    let url: URL

    init() throws {
        let made = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-decode-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: made, withIntermediateDirectories: true)
        url = made.resolvingSymlinksInPath()
    }

    func path(_ name: String) -> String { url.appendingPathComponent(name).path }

    var confinement: PathConfinement { PathConfinement(roots: [url.path]) }

    deinit {
        try? FileManager.default.removeItem(at: url)
    }
}

/// An NV12 buffer of `width` × `height` filled by `luma(x, y)` and `chroma(x, y) -> (cb, cr)` per 2×2 block.
func makeNV12(
    width: Int, height: Int, fullRange: Bool = false,
    luma: (Int, Int) -> UInt8, chroma: (Int, Int) -> (UInt8, UInt8) = { _, _ in (128, 128) }
) -> CVPixelBuffer? {
    var made: CVPixelBuffer?
    let format = fullRange ? kCVPixelFormatType_420YpCbCr8BiPlanarFullRange : kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    guard CVPixelBufferCreate(nil, width, height, format, nil, &made) == kCVReturnSuccess, let buffer = made else { return nil }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    if let base = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) {
        let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        for y in 0 ..< height { for x in 0 ..< width { bytes[y * stride + x] = luma(x, y) } }
    }
    if let base = CVPixelBufferGetBaseAddressOfPlane(buffer, 1) {
        let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1)
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        for y in 0 ..< (height + 1) / 2 {
            for x in 0 ..< (width + 1) / 2 {
                let (cb, cr) = chroma(x, y)
                bytes[y * stride + 2 * x] = cb
                bytes[y * stride + 2 * x + 1] = cr
            }
        }
    }
    return buffer
}

/// The repo's bundled FFmpeg (LGPL build; `tools/ffmpeg/dist`). Fixtures are encoded in software (OpenH264): these
/// tests decode with VideoToolbox but never encode with it.
enum DecodeFixtures {
    static let ffmpeg: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("../../tools/ffmpeg/dist/ffmpeg").standardizedFileURL

    static var available: Bool { FileManager.default.isExecutableFile(atPath: ffmpeg.path) }

    /// Runs the bundled FFmpeg; throws with its stderr tail when it fails.
    static func run(_ arguments: [String]) throws {
        let process = Process()
        process.executableURL = ffmpeg
        process.arguments = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y"] + arguments
        let errors = Pipe()
        process.standardError = errors
        try process.run()
        let tail = errors.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw DecodeFixtureError.ffmpeg(String(decoding: tail.suffix(2000), as: UTF8.self))
        }
    }

    /// `frames` frames of FFmpeg's testsrc2 at `rate` fps, H.264 (OpenH264), with a keyframe every `gop` frames.
    static func h264(_ path: String, width: Int = 320, height: Int = 180, frames: Int, rate: Int = 30, gop: Int = 12,
                     extra: [String] = []) throws {
        try run([
            "-f", "lavfi", "-i", "testsrc2=size=\(width)x\(height):rate=\(rate)", "-frames:v", "\(frames)",
            "-c:v", "libopenh264", "-g", "\(gop)", "-pix_fmt", "yuv420p",
        ] + extra + [path])
    }
}

enum DecodeFixtureError: Error {
    case ffmpeg(String)
}
