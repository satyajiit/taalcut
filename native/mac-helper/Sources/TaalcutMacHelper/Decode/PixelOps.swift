// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreVideo
import Foundation
import VideoToolbox

/// IOSurface-backed buffers of one size and format.
private func makePool(width: Int, height: Int, format: OSType) -> Result<CVPixelBufferPool, PassFailure> {
    let attributes: [CFString: Any] = [
        kCVPixelBufferPixelFormatTypeKey: format,
        kCVPixelBufferWidthKey: width,
        kCVPixelBufferHeightKey: height,
        kCVPixelBufferIOSurfacePropertiesKey: [CFString: Any](),
    ]
    var pool: CVPixelBufferPool?
    let status = CVPixelBufferPoolCreate(nil, nil, attributes as CFDictionary, &pool)
    guard status == kCVReturnSuccess, let pool else { return .failure(.failed("CVPixelBufferPoolCreate \(status)")) }
    return .success(pool)
}

private func buffer(from pool: CVPixelBufferPool) -> Result<CVPixelBuffer, PassFailure> {
    var made: CVPixelBuffer?
    let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &made)
    guard status == kCVReturnSuccess, let made else { return .failure(.failed("CVPixelBufferPoolCreatePixelBuffer \(status)")) }
    return .success(made)
}

/// FFmpeg's `scale_vt` (libavfilter/vf_scale_vt.c): a VTPixelTransferSession in `CropSourceToCleanAperture` mode,
/// the source's clean aperture set to its whole picture, the pixel format kept. Same calls, so the same bytes.
final class PassScaler {
    let width: Int
    let height: Int
    private let session: VTPixelTransferSession
    private let pool: CVPixelBufferPool

    static func make(width: Int, height: Int, format: OSType) -> Result<PassScaler, PassFailure> {
        var created: VTPixelTransferSession?
        let status = VTPixelTransferSessionCreate(allocator: nil, pixelTransferSessionOut: &created)
        guard status == noErr, let created else { return .failure(.failed("VTPixelTransferSessionCreate \(status)")) }
        VTSessionSetProperty(created, key: kVTPixelTransferPropertyKey_ScalingMode, value: kVTScalingMode_CropSourceToCleanAperture)
        return makePool(width: width, height: height, format: format).map {
            PassScaler(width: width, height: height, session: created, pool: $0)
        }
    }

    private init(width: Int, height: Int, session: VTPixelTransferSession, pool: CVPixelBufferPool) {
        self.width = width
        self.height = height
        self.session = session
        self.pool = pool
    }

    func scale(_ source: CVPixelBuffer) -> Result<CVPixelBuffer, PassFailure> {
        let w = CVPixelBufferGetWidth(source)
        let h = CVPixelBufferGetHeight(source)
        let aperture: [CFString: Any] = [
            kCVImageBufferCleanApertureWidthKey: w,
            kCVImageBufferCleanApertureHeightKey: h,
            kCVImageBufferCleanApertureHorizontalOffsetKey: 0,
            kCVImageBufferCleanApertureVerticalOffsetKey: 0,
        ]
        CVBufferSetAttachment(source, kCVImageBufferCleanApertureKey, aperture as CFDictionary, .shouldPropagate)
        return buffer(from: pool).flatMap { target in
            let status = VTPixelTransferSessionTransferImage(session, from: source, to: target)
            return status == noErr ? .success(target) : .failure(.failed("VTPixelTransferSessionTransferImage \(status)"))
        }
    }

    deinit {
        VTPixelTransferSessionInvalidate(session)
    }
}

/// FFmpeg's `transpose_vt` (libavfilter/vf_transpose_vt.c): a VTPixelRotationSession, no flips. The plan's rotation is
/// the clockwise turn that makes the picture upright (90 = `clock`, 180 = `reversal`, 270 = `cclock`).
/// `transpose_vt`'s turn for a stream's frames: the rotation session is made at the first frame (it takes the
/// decoded picture's size); no session for an upright stream. `decode.pass` and `decode.frames` share it.
final class LazyRotator {
    private let rotation: Int
    private let format: OSType
    private var rotator: PassRotator?
    private var ready = false

    init(rotation: Int, format: OSType) {
        self.rotation = rotation
        self.format = format
    }

    func turn(_ decoded: CVPixelBuffer) -> Result<CVPixelBuffer, PassFailure> {
        if !ready {
            let made = PassRotator.make(
                rotation: rotation, width: CVPixelBufferGetWidth(decoded), height: CVPixelBufferGetHeight(decoded),
                format: format)
            guard case .success(let rotator) = made else { return made.map { _ in decoded } }
            self.rotator = rotator
            ready = true
        }
        return rotator?.rotate(decoded) ?? .success(decoded)
    }
}

final class PassRotator {
    private let session: VTPixelRotationSession
    private let pool: CVPixelBufferPool

    static func make(rotation: Int, width: Int, height: Int, format: OSType) -> Result<PassRotator?, PassFailure> {
        let turn: CFString
        switch rotation {
        case 90: turn = kVTRotation_CW90
        case 180: turn = kVTRotation_180
        case 270: turn = kVTRotation_CCW90
        default: return .success(nil)
        }
        var created: VTPixelRotationSession?
        let status = VTPixelRotationSessionCreate(kCFAllocatorDefault, &created)
        guard status == noErr, let created else { return .failure(.failed("VTPixelRotationSessionCreate \(status)")) }
        VTSessionSetProperty(created, key: kVTPixelRotationPropertyKey_Rotation, value: turn)
        VTSessionSetProperty(created, key: kVTPixelRotationPropertyKey_FlipVerticalOrientation, value: kCFBooleanFalse)
        VTSessionSetProperty(created, key: kVTPixelRotationPropertyKey_FlipHorizontalOrientation, value: kCFBooleanFalse)
        let swap = rotation != 180
        return makePool(width: swap ? height : width, height: swap ? width : height, format: format).map {
            PassRotator(session: created, pool: $0)
        }
    }

    private init(session: VTPixelRotationSession, pool: CVPixelBufferPool) {
        self.session = session
        self.pool = pool
    }

    func rotate(_ source: CVPixelBuffer) -> Result<CVPixelBuffer, PassFailure> {
        buffer(from: pool).flatMap { target in
            let status = VTPixelRotationSessionRotateImage(session, source, target)
            return status == noErr ? .success(target) : .failure(.failed("VTPixelRotationSessionRotateImage \(status)"))
        }
    }

    deinit {
        VTPixelRotationSessionInvalidate(session)
    }
}

/// Copies the planes of an NV12 buffer into `out` tightly packed (luma rows, then interleaved chroma rows), the
/// layout FFmpeg's `-f rawvideo -pix_fmt nv12` reads. `lumaOnly` keeps the first plane (gray8).
func packNV12(_ buffer: CVPixelBuffer, into out: inout [UInt8], lumaOnly: Bool = false) {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    let width = CVPixelBufferGetWidthOfPlane(buffer, 0)
    let height = CVPixelBufferGetHeightOfPlane(buffer, 0)
    let chromaRows = (height + 1) / 2
    let rowBytes = (width + 1) / 2 * 2
    let size = width * height + (lumaOnly ? 0 : rowBytes * chromaRows)
    if out.count != size { out = [UInt8](repeating: 0, count: size) }
    out.withUnsafeMutableBytes { raw in
        guard let base = raw.baseAddress else { return }
        var offset = 0
        for (plane, rows, bytes) in [(0, height, width), (1, chromaRows, rowBytes)] where plane == 0 || !lumaOnly {
            guard let source = CVPixelBufferGetBaseAddressOfPlane(buffer, plane) else { continue }
            let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, plane)
            for row in 0 ..< rows {
                memcpy(base + offset, source + row * stride, bytes)
                offset += bytes
            }
        }
    }
}
