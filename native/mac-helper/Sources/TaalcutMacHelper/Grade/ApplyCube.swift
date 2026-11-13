// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import Metal

private let cubeFallback = "[grade] CPU fallback: no Metal device\n"

func applyVideoCube(
    params: JSONValue, progress: @escaping @Sendable (Double) -> Void, confinement: PathConfinement
) async -> WorkResponse {
    guard params.key("colourSpace")?.string == "bt709" else {
        return .fail(.badRequest("colourSpace must be bt709"))
    }
    guard let input = params.key("input")?.string, let output = params.key("output")?.string,
        let cube = params.key("cube")?.string
    else { return .fail(.badRequest("input, output and cube are required")) }
    switch confinement.resolve(input) {
    case .failure(let failure): return .fail(failure)
    case .success(let inputURL):
        switch confinement.resolve(cube) {
        case .failure(let failure): return .fail(failure)
        case .success(let cubeURL):
            switch resolveParent(output, confinement: confinement) {
            case .failure(let failure): return .fail(failure)
            case .success(let outputURL):
                return await grade(inputURL, outputURL: outputURL, cubeURL: cubeURL, progress: progress)
            }
        }
    }
}

private func grade(
    _ inputURL: URL, outputURL: URL, cubeURL: URL, progress: @escaping @Sendable (Double) -> Void
) async -> WorkResponse {
    guard let text = try? String(contentsOf: cubeURL, encoding: .utf8) else {
        return .fail(.failed("grade.unreadable", "cube is unreadable", retryable: false))
    }
    let lut: CubeLUT
    switch parseCube(text) {
    case .failure: return .fail(.failed("grade.cube_invalid", "cube must be a 17 cube", retryable: false))
    case .success(let parsed): lut = parsed
    }
    guard FileManager.default.fileExists(atPath: inputURL.path) else {
        return .fail(.failed("grade.unreadable", "input is unreadable", retryable: false))
    }
    guard let metal = MTLCreateSystemDefaultDevice() else {
        FileHandle.standardError.write(Data(cubeFallback.utf8))
        return .fail(.failed("grade.no_metal", "no Metal device", retryable: false))
    }
    let clock = ContinuousClock()
    let started = clock.now
    do {
        let written = try await writeGraded(
            inputURL, outputURL: outputURL, lut: lut, metal: metal, progress: progress)
        return .ok(.object([
            "output": .string(outputURL.path),
            "width": .number(Double(written.width)),
            "height": .number(Double(written.height)),
            "frames": .number(Double(written.frames)),
            "compute": .string("gpu"),
            "ms": .number(Double(milliseconds(since: started, clock: clock))),
        ]))
    } catch is CancellationError {
        removeFile(outputURL)
        return .fail(.cancelled)
    } catch let error as ShotReadError {
        removeFile(outputURL)
        switch error {
        case .unreadable:
            return .fail(.failed("grade.unreadable", "input is unreadable", retryable: false))
        case .decodeFailed:
            return .fail(.failed("grade.failed", "could not grade the movie", retryable: true))
        }
    } catch {
        removeFile(outputURL)
        return .fail(.failed("grade.failed", "could not grade the movie", retryable: true))
    }
}

private struct GradedClip {
    var width: Int
    var height: Int
    var frames: Int
}

private func writeGraded(
    _ inputURL: URL, outputURL: URL, lut: CubeLUT, metal: MTLDevice,
    progress: @escaping @Sendable (Double) -> Void
) async throws -> GradedClip {
    removeFile(outputURL)
    let context = CIContext(mtlDevice: metal)
    guard let filter = CIFilter(name: "CIColorCubeWithColorSpace") else { throw ShotReadError.decodeFailed }
    filter.setValue(CubeLUT.dimension, forKey: "inputCubeDimension")
    filter.setValue(cubeData(lut), forKey: "inputCubeData")
    filter.setValue(CGColorSpace(name: CGColorSpace.itur_709), forKey: "inputColorSpace")
    if filter.inputKeys.contains("inputExtrapolate") { filter.setValue(false, forKey: "inputExtrapolate") }
    let asset = AVURLAsset(url: inputURL)
    let duration = (try? await asset.load(.duration)) ?? .zero
    guard duration.isNumeric, duration.seconds > 0 else { throw ShotReadError.unreadable }
    let span = duration.seconds
    var frames = 0
    var writerBox: GradeWriter?
    do {
        _ = try await readShot(url: inputURL, start: .zero, end: duration, shortSide: nil) { buffer, time, _ in
            if Task.isCancelled { throw CancellationError() }
            if writerBox == nil {
                let width = CVPixelBufferGetWidth(buffer)
                let height = CVPixelBufferGetHeight(buffer)
                writerBox = try GradeWriter(url: outputURL, width: width, height: height)
            }
            guard let writer = writerBox else { throw ShotReadError.decodeFailed }
            try writer.append(filter: filter, buffer: buffer, time: time, context: context)
            frames += 1
            progress(min(1, max(0, time.seconds / span)))
        }
    } catch {
        writerBox?.cancel()
        throw error
    }
    guard let writer = writerBox, frames > 0 else {
        writerBox?.cancel()
        throw ShotReadError.decodeFailed
    }
    try await writer.finish()
    return GradedClip(width: writer.width, height: writer.height, frames: frames)
}

/// One H.264 writer. Used on the grade task only.
private final class GradeWriter {
    let width: Int
    let height: Int
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor

    init(url: URL, width: Int, height: Int) throws {
        self.width = width
        self.height = height
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ])
        input.expectsMediaDataInRealTime = false
        adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
                kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
            ])
        guard writer.canAdd(input) else { throw ShotReadError.decodeFailed }
        writer.add(input)
        guard writer.startWriting() else { throw ShotReadError.decodeFailed }
        writer.startSession(atSourceTime: .zero)
    }

    func append(filter: CIFilter, buffer: CVPixelBuffer, time: CMTime, context: CIContext) throws {
        let image = CIImage(cvPixelBuffer: buffer)
        filter.setValue(image, forKey: kCIInputImageKey)
        guard let graded = filter.outputImage, let pool = adaptor.pixelBufferPool else { throw ShotReadError.decodeFailed }
        var rendered: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &rendered) == kCVReturnSuccess, let rendered else {
            throw ShotReadError.decodeFailed
        }
        let space = CGColorSpace(name: CGColorSpace.itur_709)
        context.render(graded, to: rendered, bounds: graded.extent, colorSpace: space)
        var spins = 0
        while !input.isReadyForMoreMediaData && spins < 4000 {
            if Task.isCancelled { throw CancellationError() }
            spins += 1
            Thread.sleep(forTimeInterval: 0.002)
        }
        guard input.isReadyForMoreMediaData, adaptor.append(rendered, withPresentationTime: time) else {
            throw ShotReadError.decodeFailed
        }
    }

    func finish() async throws {
        input.markAsFinished()
        await writer.finishWriting()
        if writer.status != .completed { throw ShotReadError.decodeFailed }
    }

    func cancel() { writer.cancelWriting() }
}

private func resolveParent(_ path: String, confinement: PathConfinement) -> Result<URL, HelperFailure> {
    switch confinement.resolve(path) {
    case .failure(let failure): return .failure(failure)
    case .success(let url):
        var isDirectory: ObjCBool = false
        let parent = url.deletingLastPathComponent().path
        guard FileManager.default.fileExists(atPath: parent, isDirectory: &isDirectory), isDirectory.boolValue else {
            return .failure(.badRequest("output parent does not exist"))
        }
        return .success(url)
    }
}

private func removeFile(_ url: URL) {
    if FileManager.default.fileExists(atPath: url.path) { try? FileManager.default.removeItem(at: url) }
}
