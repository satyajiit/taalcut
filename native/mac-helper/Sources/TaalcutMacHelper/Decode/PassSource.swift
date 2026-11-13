// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import AVFoundation
import CoreMedia
import Foundation
import VideoToolbox

enum PassFailure: Error, Equatable {
    case unreadable(String)
    case unsupported(String)
    /// VideoToolbox reported the session or decoder broken (−17691, −12911): the session is invalidated, never killed.
    case malfunction(Int32)
    case decodeFailed(Int32)
    case offGrid(found: Int, expected: Int)
    case outputClosed(String)
    case cancelled
    case failed(String)
}

/// The decode's cancel: set by the request's cancellation, read by the decode loop between samples.
final class PassCancel: @unchecked Sendable {  // NSLock guards `cancelled`
    private let lock = NSLock()
    private var cancelled = false

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }
}

/// The video track and what the decode needs from it, loaded before the decode thread starts.
struct PassSource: @unchecked Sendable {  // AVFoundation objects, handed to the one decode thread and used only there
    let asset: AVURLAsset
    let track: AVAssetTrack
    let format: CMFormatDescription
    /// Grid frame 0's time: the start of the track's range on the movie timeline (FFmpeg's STARTPTS for the file).
    let origin: CMTime
    /// The decoder's output format: NV12, full or video range as the bitstream says (what FFmpeg's hwaccel asks for).
    let pixelFormat: OSType

    var fullRange: Bool { pixelFormat == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange }

    static func open(_ url: URL) async -> Result<PassSource, PassFailure> {
        let asset = AVURLAsset(url: url)
        let tracks: [AVAssetTrack]
        do {
            tracks = try await asset.loadTracks(withMediaType: .video)
        } catch {
            return .failure(.unreadable("\(error.localizedDescription)"))
        }
        guard let track = tracks.first else { return .failure(.unreadable("no video track")) }
        let range: CMTimeRange
        let formats: [CMFormatDescription]
        do {
            (range, formats) = try await track.load(.timeRange, .formatDescriptions)
        } catch {
            return .failure(.unreadable("\(error.localizedDescription)"))
        }
        // One format for the whole track: a change mid-stream would need a new session, and FFmpeg's grid with it.
        guard formats.count == 1, let format = formats.first else {
            return .failure(.unsupported("\(formats.count) video formats in the track"))
        }
        let codec = CMFormatDescriptionGetMediaSubType(format)
        guard [kCMVideoCodecType_H264, kCMVideoCodecType_HEVC].contains(codec) else {
            return .failure(.unsupported("codec \(codec)"))
        }
        let bits = CMFormatDescriptionGetExtension(format, extensionKey: kCMFormatDescriptionExtension_BitsPerComponent) as? Int
        if let bits, bits > 8 { return .failure(.unsupported("\(bits)-bit video")) }
        let full = (CMFormatDescriptionGetExtension(format, extensionKey: kCMFormatDescriptionExtension_FullRangeVideo) as? Bool) ?? false
        let pixelFormat = full ? kCVPixelFormatType_420YpCbCr8BiPlanarFullRange : kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        return .success(PassSource(asset: asset, track: track, format: format, origin: range.start, pixelFormat: pixelFormat))
    }
}

/// Frames VideoToolbox hands back. The output handler only queues them; copying and writing happen on the decode
/// thread, so VideoToolbox's callback thread never waits on a pipe.
final class DecodedFrames: @unchecked Sendable {  // NSLock guards `items`
    struct Item {
        let image: CVImageBuffer?
        let time: CMTime
        let status: OSStatus
        let dropped: Bool
    }

    private let lock = NSLock()
    private var items: [Item] = []

    func push(_ item: Item) {
        lock.lock()
        items.append(item)
        lock.unlock()
    }

    func drain() -> [Item] {
        lock.lock()
        defer { lock.unlock() }
        let out = items
        items.removeAll(keepingCapacity: true)
        return out
    }
}

extension DecodedFrames {
    /// Hands `sample` to `session` with several frames in flight; each decoded frame (or its error) lands here.
    func submit(_ sample: CMSampleBuffer, to session: VTDecompressionSession) -> PassFailure? {
        let flags: VTDecodeFrameFlags = [._EnableAsynchronousDecompression, ._EnableTemporalProcessing]
        let status = VTDecompressionSessionDecodeFrame(session, sampleBuffer: sample, flags: flags, infoFlagsOut: nil) {
            status, info, image, time, _ in
            self.push(.init(image: image, time: time, status: status, dropped: info.contains(.frameDropped)))
        }
        if malfunctionStatuses.contains(status) { return .malfunction(status) }
        return status == noErr ? nil : .decodeFailed(status)
    }
}

/// VideoToolbox statuses after which the session is not trusted again (the stall signature of 2026-10-17 is −17691).
let malfunctionStatuses: Set<OSStatus> = [kVTVideoDecoderMalfunctionErr, kVTSessionMalfunctionErr]

/// A hardware decompression session for the track's format, decoding into `pixelFormat` IOSurface buffers.
func makeDecompressionSession(_ source: PassSource) -> Result<VTDecompressionSession, PassFailure> {
    let attributes: [CFString: Any] = [
        kCVPixelBufferPixelFormatTypeKey: source.pixelFormat,
        kCVPixelBufferIOSurfacePropertiesKey: [CFString: Any](),
    ]
    let specification = [kVTVideoDecoderSpecification_RequireHardwareAcceleratedVideoDecoder: kCFBooleanTrue] as CFDictionary
    var created: VTDecompressionSession?
    let status = VTDecompressionSessionCreate(
        allocator: nil, formatDescription: source.format, decoderSpecification: specification,
        imageBufferAttributes: attributes as CFDictionary, outputCallback: nil, decompressionSessionOut: &created)
    guard status == noErr, let created else {
        // No hardware decoder for this stream: the caller's software or FFmpeg route takes it.
        return .failure(.unsupported("VTDecompressionSessionCreate \(status)"))
    }
    return .success(created)
}
