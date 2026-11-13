// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import AVFoundation
import CoreMedia
import CoreVideo
import Foundation

struct ShotSize: Sendable {
    var width: Int
    var height: Int
}

enum ShotReadError: Error {
    case unreadable
    case decodeFailed
}

/// Decodes `[start, end)` with the preferred transform applied, short side `shortSide`, 32BGRA.
/// The sample stays alive until `body` returns, so the pixel buffer is not reused underneath it.
func readShot(
    url: URL, start: CMTime, end: CMTime, shortSide: Int?,
    body: (CVPixelBuffer, CMTime, Bool) async throws -> Void
) async throws -> ShotSize {
    let asset = AVURLAsset(url: url)
    let tracks: [AVAssetTrack]
    do {
        tracks = try await asset.loadTracks(withMediaType: .video)
    } catch {
        throw ShotReadError.unreadable
    }
    guard let track = tracks.first else { throw ShotReadError.unreadable }
    let natural: CGSize
    let preferred: CGAffineTransform
    let frameRate: Float
    do {
        natural = try await track.load(.naturalSize)
        preferred = try await track.load(.preferredTransform)
        frameRate = try await track.load(.nominalFrameRate)
    } catch {
        throw ShotReadError.decodeFailed
    }
    let output = fittedSize(natural: natural, transform: preferred, shortSide: shortSide)
    let composition = scaledComposition(
        track: track, natural: natural, preferred: preferred, output: output, start: start, end: end, frameRate: frameRate)
    let reader: AVAssetReader
    do {
        reader = try AVAssetReader(asset: asset)
    } catch {
        throw ShotReadError.decodeFailed
    }
    reader.timeRange = CMTimeRange(start: start, end: end)
    let port = AVAssetReaderVideoCompositionOutput(videoTracks: [track], videoSettings: pixelSettings(output))
    port.videoComposition = composition
    port.alwaysCopiesSampleData = false
    guard reader.canAdd(port) else { throw ShotReadError.decodeFailed }
    reader.add(port)
    guard reader.startReading() else { throw ShotReadError.decodeFailed }
    var pending = port.copyNextSampleBuffer()
    while let sample = pending {
        if Task.isCancelled { throw CancellationError() }
        pending = port.copyNextSampleBuffer()
        let time = CMSampleBufferGetPresentationTimeStamp(sample)
        if let buffer = CMSampleBufferGetImageBuffer(sample) {
            try await body(buffer, time, pending == nil)
        }
    }
    if reader.status == .failed { throw ShotReadError.decodeFailed }
    return ShotSize(width: output.width, height: output.height)
}

private func fittedSize(natural: CGSize, transform: CGAffineTransform, shortSide: Int?) -> (width: Int, height: Int) {
    let rect = CGRect(origin: .zero, size: natural).applying(transform)
    let displayW = abs(rect.width)
    let displayH = abs(rect.height)
    let scale: CGFloat
    if let shortSide {
        let short = min(displayW, displayH)
        scale = short > 0 ? CGFloat(shortSide) / short : 1
    } else {
        scale = 1
    }
    var width = max(2, Int((displayW * scale).rounded()))
    var height = max(2, Int((displayH * scale).rounded()))
    if width % 2 != 0 { width += 1 }
    if height % 2 != 0 { height += 1 }
    return (width, height)
}

private func scaledComposition(
    track: AVAssetTrack, natural: CGSize, preferred: CGAffineTransform,
    output: (width: Int, height: Int), start: CMTime, end: CMTime, frameRate: Float
) -> AVMutableVideoComposition {
    let rect = CGRect(origin: .zero, size: natural).applying(preferred)
    let display = CGSize(width: max(abs(rect.width), 1), height: max(abs(rect.height), 1))
    let translate = CGAffineTransform(translationX: -rect.origin.x, y: -rect.origin.y)
    let scale = CGAffineTransform(scaleX: CGFloat(output.width) / display.width, y: CGFloat(output.height) / display.height)
    let fitted = preferred.concatenating(translate).concatenating(scale)
    let composition = AVMutableVideoComposition()
    composition.renderSize = CGSize(width: output.width, height: output.height)
    let rate = frameRate > 1 ? frameRate : 30
    composition.frameDuration = CMTime(seconds: 1 / Double(rate), preferredTimescale: 600)
    let instruction = AVMutableVideoCompositionInstruction()
    let span = CMTimeSubtract(end, start)
    instruction.timeRange = CMTimeRange(start: start, duration: span.seconds > 0 ? span : CMTime(value: 1, timescale: 30))
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layer.setTransform(fitted, at: start)
    instruction.layerInstructions = [layer]
    composition.instructions = [instruction]
    return composition
}

private func pixelSettings(_ size: (width: Int, height: Int)) -> [String: Any] {
    [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: size.width,
        kCVPixelBufferHeightKey as String: size.height,
        kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
        kCVPixelBufferMetalCompatibilityKey as String: true,
    ]
}
