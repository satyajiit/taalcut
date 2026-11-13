// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreVideo
import Foundation

/// Where `decode.frames` writes: per set, the frames it asks for, turned upright once (`transpose_vt`), scaled on the
/// GPU to the set's size (`scale_vt`, skipped when the size is already right) and appended as packed NV12, the bytes
/// FFmpeg's route downloads before it converts them. The caller converts them as that route would.
final class FramesOutputs {
    private struct SetWriter {
        let output: FramesSetOutput
        let wanted: Set<Int>
        let sink: RawSink
        var scaler: PassScaler?
        var scalerReady = false
        var written: [Int] = []
    }

    private let pixelFormat: OSType
    private let rotator: LazyRotator
    private var sets: [SetWriter]
    private var packed = [UInt8]()

    private init(rotation: Int, pixelFormat: OSType, sets: [SetWriter]) {
        self.pixelFormat = pixelFormat
        rotator = LazyRotator(rotation: rotation, format: pixelFormat)
        self.sets = sets
    }

    static func open(_ params: DecodeFramesParams, pixelFormat: OSType, cancel: PassCancel) -> Result<FramesOutputs, PassFailure> {
        var sets: [SetWriter] = []
        for output in params.sets {
            switch RawSink.open(output.path, cancel: cancel) {
            case .success(let sink): sets.append(SetWriter(output: output, wanted: Set(output.frames), sink: sink))
            case .failure(let failure):
                for set in sets { set.sink.close() }
                return .failure(failure)
            }
        }
        return .success(FramesOutputs(rotation: params.rotation, pixelFormat: pixelFormat, sets: sets))
    }

    /// Per set, the frames written so far, in file order.
    var written: [[Int]] { sets.map(\.written) }

    /// Writes `decoded` (grid frame `index`) to every set that asks for it. A frame at or before one a set already
    /// has is a repeat on the grid: FFmpeg would place it elsewhere, so the request fails.
    func accept(_ decoded: CVPixelBuffer, index: Int) -> Result<Void, PassFailure> {
        let takers = sets.indices.filter { sets[$0].wanted.contains(index) }
        guard !takers.isEmpty else { return .success(()) }
        let upright: CVPixelBuffer
        switch rotator.turn(decoded) {
        case .success(let picture): upright = picture
        case .failure(let failure): return .failure(failure)
        }
        for i in takers {
            if let last = sets[i].written.last, index <= last { return .failure(.offGrid(found: index, expected: last + 1)) }
            if case .failure(let failure) = write(i, upright) { return .failure(failure) }
            sets[i].written.append(index)
        }
        return .success(())
    }

    func close() {
        for set in sets { set.sink.close() }
    }

    private func write(_ i: Int, _ upright: CVPixelBuffer) -> Result<Void, PassFailure> {
        if !sets[i].scalerReady {
            let (w, h) = (sets[i].output.width, sets[i].output.height)
            if w != CVPixelBufferGetWidth(upright) || h != CVPixelBufferGetHeight(upright) {
                switch PassScaler.make(width: w, height: h, format: pixelFormat) {
                case .success(let made): sets[i].scaler = made
                case .failure(let failure): return .failure(failure)
                }
            }
            sets[i].scalerReady = true
        }
        let picture: CVPixelBuffer
        switch sets[i].scaler?.scale(upright) ?? .success(upright) {
        case .success(let made): picture = made
        case .failure(let failure): return .failure(failure)
        }
        packNV12(picture, into: &packed)
        return sets[i].sink.write(packed)
    }
}
