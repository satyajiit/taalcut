// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreMedia
import CoreVideo
import Foundation

/// YCbCr to RGB for frame-set pictures (OCR frames, the shot detector's small frames). FFmpeg's pass converts the
/// `scale_vt` NV12 frame to rgb24 on the CPU with swscale; this does the same conversion on the same NV12 bytes:
/// BT.601 unless the stream says BT.709 (swscale's default for an untagged stream), video or full range as decoded,
/// each chroma sample shared by its 2×2 block. It is not swscale's code, so pixels may differ by a level or two
/// (the parity test states the tolerance).
struct YCbCrToRGB: Sendable {
    let yOffset: Float
    let yScale: Float
    let crToR: Float
    let cbToG: Float
    let crToG: Float
    let cbToB: Float
    /// Luma to gray8 levels: FFmpeg writes gray frame files full range, so a video-range stream's luma is stretched.
    let grayLevels: [UInt8]

    static func forStream(_ format: CMFormatDescription, fullRange: Bool) -> YCbCrToRGB {
        let matrix = CMFormatDescriptionGetExtension(format, extensionKey: kCMFormatDescriptionExtension_YCbCrMatrix) as? String
        let bt709 = matrix == (kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2 as String)
        // Kr, Kb per matrix; video range stretches Y 16–235 and C 16–240 to full.
        let (kr, kb): (Float, Float) = bt709 ? (0.2126, 0.0722) : (0.299, 0.114)
        let kg = 1 - kr - kb
        let cScale: Float = fullRange ? 1 : 255 / 224
        return YCbCrToRGB(
            yOffset: fullRange ? 0 : 16,
            yScale: fullRange ? 1 : 255 / 219,
            crToR: 2 * (1 - kr) * cScale,
            cbToG: 2 * (1 - kb) * kb / kg * cScale,
            crToG: 2 * (1 - kr) * kr / kg * cScale,
            cbToB: 2 * (1 - kb) * cScale,
            grayLevels: (0 ... 255).map { fullRange ? UInt8($0) : stretchedLuma(UInt8($0)) })
    }

    /// Packs an NV12 buffer's luma as gray8 into `out` (width × height bytes), in FFmpeg's full-range levels.
    func packGray(_ buffer: CVPixelBuffer, into out: inout [UInt8]) {
        packNV12(buffer, into: &out, lumaOnly: true)
        let levels = grayLevels
        out.withUnsafeMutableBufferPointer { bytes in
            for i in bytes.indices { bytes[i] = levels[Int(bytes[i])] }
        }
    }

    /// Packs an NV12 buffer as rgb24 into `out` (width × height × 3 bytes).
    func pack(_ buffer: CVPixelBuffer, into out: inout [UInt8]) {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let width = CVPixelBufferGetWidthOfPlane(buffer, 0)
        let height = CVPixelBufferGetHeightOfPlane(buffer, 0)
        if out.count != width * height * 3 { out = [UInt8](repeating: 0, count: width * height * 3) }
        guard let lumaBase = CVPixelBufferGetBaseAddressOfPlane(buffer, 0),
              let chromaBase = CVPixelBufferGetBaseAddressOfPlane(buffer, 1)
        else { return }
        let luma = lumaBase.assumingMemoryBound(to: UInt8.self)
        let chroma = chromaBase.assumingMemoryBound(to: UInt8.self)
        let lumaStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
        let chromaStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1)
        out.withUnsafeMutableBufferPointer { rgb in
            for row in 0 ..< height {
                let chromaRow = chroma + (row / 2) * chromaStride
                for column in 0 ..< width {
                    let y = (Float(luma[row * lumaStride + column]) - yOffset) * yScale
                    let pair = (column / 2) * 2
                    let cb = Float(chromaRow[pair]) - 128
                    let cr = Float(chromaRow[pair + 1]) - 128
                    let at = (row * width + column) * 3
                    rgb[at] = clampByte(y + crToR * cr)
                    rgb[at + 1] = clampByte(y - cbToG * cb - crToG * cr)
                    rgb[at + 2] = clampByte(y + cbToB * cb)
                }
            }
        }
    }
}

/// swscale's video-to-full range luma stretch on its 15-bit intermediates (`lumRangeToJpeg`), then its 8-bit
/// output with the flat 64 dither an 8-bit source gets: the gray8 bytes FFmpeg writes for a video-range frame.
func stretchedLuma(_ luma: UInt8) -> UInt8 {
    let intermediate = min(Int(luma) << 7, 30189)
    let stretched = (intermediate * 19077 - 39_057_361) >> 14
    return UInt8(max(0, min(255, (stretched + 64) >> 7)))
}

@inline(__always)
private func clampByte(_ value: Float) -> UInt8 {
    UInt8(max(0, min(255, value.rounded())))
}
