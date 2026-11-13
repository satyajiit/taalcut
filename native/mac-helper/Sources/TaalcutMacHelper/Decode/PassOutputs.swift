// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreVideo
import Foundation

/// Where each grid frame goes, as FFmpeg's pass graph sends it: turned upright once (`transpose_vt`), then per
/// output scaled on the GPU (`scale_vt`, skipped when the size is already right) and copied out. The analysis output
/// takes every frame as NV12; a frame set takes every `every`-th frame of the window (`select='not(mod(n,every))'`)
/// up to `maxFrames` (`-frames:v`), as rgb24 or gray8.
final class PassOutputs {
    private struct SetWriter {
        let output: FrameSetOutput
        let sink: RawSink
        var scaler: PassScaler?
        var frames = 0
    }

    private let params: DecodePassParams
    private let pixelFormat: OSType
    private let colour: YCbCrToRGB
    private let analysisSink: RawSink
    private var sets: [SetWriter]
    private let rotator: LazyRotator
    private var analysisScaler: PassScaler?
    private var scalersReady = false
    private var packed = [UInt8]()
    private var converted = [UInt8]()

    private init(params: DecodePassParams, pixelFormat: OSType, colour: YCbCrToRGB, analysisSink: RawSink, sets: [SetWriter]) {
        self.params = params
        self.pixelFormat = pixelFormat
        rotator = LazyRotator(rotation: params.rotation, format: pixelFormat)
        self.colour = colour
        self.analysisSink = analysisSink
        self.sets = sets
    }

    /// Opens every output. Frame-set files first: the analysis output may be a FIFO whose reader waits for frames.
    static func open(
        _ params: DecodePassParams, source: PassSource, cancel: PassCancel
    ) -> Result<PassOutputs, PassFailure> {
        var sets: [SetWriter] = []
        for output in params.sets {
            switch RawSink.open(output.path, cancel: cancel) {
            case .success(let sink): sets.append(SetWriter(output: output, sink: sink))
            case .failure(let failure): return .failure(failure)
            }
        }
        let colour = YCbCrToRGB.forStream(source.format, fullRange: source.fullRange)
        return RawSink.open(params.analysis.path, cancel: cancel).map {
            PassOutputs(params: params, pixelFormat: source.pixelFormat, colour: colour, analysisSink: $0, sets: sets)
        }
    }

    /// Frames written to each frame set, in request order.
    var setFrames: [Int] { sets.map(\.frames) }

    func accept(_ decoded: CVPixelBuffer, index: Int) -> Result<Void, PassFailure> {
        let upright: CVPixelBuffer
        switch rotator.turn(decoded) {
        case .success(let picture): upright = picture
        case .failure(let failure): return .failure(failure)
        }
        if case .failure(let failure) = prepareScalers(upright) { return .failure(failure) }
        switch scaled(upright, by: analysisScaler) {
        case .success(let picture):
            packNV12(picture, into: &packed)
            if case .failure(let failure) = analysisSink.write(packed) { return .failure(failure) }
        case .failure(let failure):
            return .failure(failure)
        }
        let offset = index - (params.window?.from ?? 0)
        for i in sets.indices where offset % sets[i].output.every == 0 && sets[i].frames < sets[i].output.maxFrames {
            if case .failure(let failure) = writeSet(i, upright) { return .failure(failure) }
        }
        return .success(())
    }

    /// Closes every output; the analysis reader sees end of file.
    func close() {
        analysisSink.close()
        for set in sets { set.sink.close() }
    }

    /// Scalers for the outputs whose size differs from the upright picture's (FFmpeg adds no `scale_vt` otherwise).
    private func prepareScalers(_ upright: CVPixelBuffer) -> Result<Void, PassFailure> {
        guard !scalersReady else { return .success(()) }
        let width = CVPixelBufferGetWidth(upright)
        let height = CVPixelBufferGetHeight(upright)
        func scaler(_ w: Int, _ h: Int) -> Result<PassScaler?, PassFailure> {
            w == width && h == height ? .success(nil) : PassScaler.make(width: w, height: h, format: pixelFormat).map { $0 }
        }
        switch scaler(params.analysis.width, params.analysis.height) {
        case .success(let made): analysisScaler = made
        case .failure(let failure): return .failure(failure)
        }
        for i in sets.indices {
            switch scaler(sets[i].output.width, sets[i].output.height) {
            case .success(let made): sets[i].scaler = made
            case .failure(let failure): return .failure(failure)
            }
        }
        scalersReady = true
        return .success(())
    }

    private func scaled(_ picture: CVPixelBuffer, by scaler: PassScaler?) -> Result<CVPixelBuffer, PassFailure> {
        scaler?.scale(picture) ?? .success(picture)
    }

    private func writeSet(_ i: Int, _ upright: CVPixelBuffer) -> Result<Void, PassFailure> {
        let picture: CVPixelBuffer
        switch scaled(upright, by: sets[i].scaler) {
        case .success(let made): picture = made
        case .failure(let failure): return .failure(failure)
        }
        switch sets[i].output.format {
        case .rgb24: colour.pack(picture, into: &converted)
        case .gray8: colour.packGray(picture, into: &converted)
        }
        if case .failure(let failure) = sets[i].sink.write(converted) { return .failure(failure) }
        sets[i].frames += 1
        return .success(())
    }
}
