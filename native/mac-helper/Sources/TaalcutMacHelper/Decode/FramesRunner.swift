// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import AVFoundation
import CoreMedia
import Foundation
import VideoToolbox

struct FramesReport: Sendable {
    /// Per set, the grid frames written, in file order.
    let written: [[Int]]
    /// Frames the decoder produced, every read's pre-roll included.
    let decoded: Int
    let reads: Int
    let decodeMs: Int
}

/// Frames closer than `gapSeconds` on the grid share one read.
func framesWindows(_ frames: [Int], rate: GridRate, gapSeconds: Double) -> [ClosedRange<Int>] {
    let gap = gapSeconds * rate.framesPerSecond
    var windows: [ClosedRange<Int>] = []
    for frame in frames {
        if let last = windows.last, Double(frame - last.upperBound) <= gap {
            windows[windows.count - 1] = last.lowerBound ... frame
        } else {
            windows.append(frame ... frame)
        }
    }
    return windows
}

/// `decode.frames` on the calling thread (it blocks): one VideoToolbox session for the whole request. Each window is
/// an AVAssetReader over the time range from the sync sample at or before the window's first frame to its last, so
/// the decoder starts at a keyframe as FFmpeg's seek does; frames are placed on the grid as FFmpeg's
/// `setpts=PTS-STARTPTS,fps=R:round=near` places them, turned and scaled as `transpose_vt`/`scale_vt` do, and written
/// as NV12. Every path out of here invalidates the session first.
func runFrames(
    _ params: DecodeFramesParams, source: PassSource, cancel: PassCancel, progress: @escaping @Sendable (Double) -> Void
) -> Result<FramesReport, PassFailure> {
    let started = DispatchTime.now()
    let session: VTDecompressionSession
    switch makeDecompressionSession(source) {
    case .success(let made): session = made
    case .failure(let failure): return .failure(failure)
    }
    let outputs: FramesOutputs
    switch FramesOutputs.open(params, pixelFormat: source.pixelFormat, cancel: cancel) {
    case .success(let opened): outputs = opened
    case .failure(let failure):
        VTDecompressionSessionInvalidate(session)
        return .failure(failure)
    }
    let windows = framesWindows(params.wanted, rate: params.rate, gapSeconds: params.gapSeconds)
    var reads = FramesReads(params: params, source: source, session: session, outputs: outputs)
    var failure: PassFailure?
    for (n, window) in windows.enumerated() {
        if cancel.isCancelled { failure = .cancelled; break }
        if let failed = reads.read(window, cancel: cancel) { failure = failed; break }
        progress(Double(n + 1) / Double(windows.count))
    }
    // A window that decoded no picture leaves its frames behind a later window's slots (IX2-F16).
    if failure == nil { failure = reads.gap(in: nil) }
    VTDecompressionSessionInvalidate(session)
    outputs.close()
    if let failure { return .failure(failure) }
    let ms = Int((DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000)
    return .success(FramesReport(written: outputs.written, decoded: reads.decoded, reads: windows.count, decodeMs: ms))
}

private struct FramesReads {
    let params: DecodeFramesParams
    let source: PassSource
    let session: VTDecompressionSession
    let outputs: FramesOutputs
    let queue = DecodedFrames()
    let wanted: Set<Int>
    var decoded = 0
    /// Wanted frames written so far, and the furthest grid slot any decoded frame landed on.
    private var placed = Set<Int>()
    private var furthest = Int.min

    init(params: DecodeFramesParams, source: PassSource, session: VTDecompressionSession, outputs: FramesOutputs) {
        self.params = params
        self.source = source
        self.session = session
        self.outputs = outputs
        wanted = Set(params.wanted)
    }

    private func time(ofSlot slot: Double) -> CMTime {
        CMTimeAdd(source.origin, CMTime(seconds: max(0, slot) / params.rate.framesPerSecond, preferredTimescale: 600_000))
    }

    /// One window: from its sync sample to its last frame, then every frame still in flight.
    mutating func read(_ window: ClosedRange<Int>, cancel: PassCancel) -> PassFailure? {
        // Half a frame either side, as rangeSeek starts FFmpeg's seek half a frame early.
        let start = time(ofSlot: Double(window.lowerBound) - 0.5)
        let end = time(ofSlot: Double(window.upperBound) + 0.5)
        let reader: AVAssetReader
        do {
            reader = try AVAssetReader(asset: source.asset)
        } catch {
            return .unreadable(error.localizedDescription)
        }
        reader.timeRange = CMTimeRange(start: syncSample(atOrBefore: start), end: end)
        let output = AVAssetReaderTrackOutput(track: source.track, outputSettings: nil)
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { return .unreadable("the reader refuses the track") }
        reader.add(output)
        guard reader.startReading() else { return .unreadable(reader.error?.localizedDescription ?? "startReading failed") }
        defer { reader.cancelReading() }
        while let sample = output.copyNextSampleBuffer() {
            if cancel.isCancelled { return .cancelled }
            guard CMSampleBufferGetNumSamples(sample) > 0 else { continue }
            if let failure = queue.submit(sample, to: session) { return failure }
            if let failure = place(queue.drain(), window: window) { return failure }
        }
        if reader.status == .failed { return .unreadable(reader.error?.localizedDescription ?? "read failed") }
        VTDecompressionSessionFinishDelayedFrames(session)
        VTDecompressionSessionWaitForAsynchronousFrames(session)
        return place(queue.drain(), window: window) ?? gap(in: window)
    }

    /// A wanted frame of `window` (nil: of the whole request, after its last window) that no decoded frame landed on
    /// while a later slot was decoded: a gap in the stream's timing, where FFmpeg's `fps` filter would repeat the
    /// frame before it. The request fails (FFmpeg decides). A wanted frame past the last decoded one is past the end:
    /// left out, as FFmpeg leaves it. Checked after each window and, for a window that decoded nothing (its frames
    /// are behind `furthest` only once a later window decodes), after the last (IX2-F16).
    func gap(in window: ClosedRange<Int>?) -> PassFailure? {
        let missing = params.wanted.first { (window?.contains($0) ?? true) && !placed.contains($0) && $0 < furthest }
        return missing.map { .offGrid(found: furthest, expected: $0) }
    }

    /// The presentation time of the last sync sample shown at or before `time`, stepping back in decode order (a
    /// sync sample shown after `time` is passed over: the frames before it may depend on the GOP before).
    private func syncSample(atOrBefore time: CMTime) -> CMTime {
        guard let cursor = source.track.makeSampleCursor(presentationTimeStamp: time) else { return source.origin }
        while !(cursor.currentSampleSyncInfo.sampleIsFullSync.boolValue && cursor.presentationTimeStamp <= time) {
            if cursor.stepInDecodeOrder(byCount: -1) != -1 { return min(cursor.presentationTimeStamp, source.origin) }
        }
        return cursor.presentationTimeStamp
    }

    /// Writes the window's wanted frames among `items`; a frame off the grid fails the request (FFmpeg decides).
    private mutating func place(_ items: [DecodedFrames.Item], window: ClosedRange<Int>) -> PassFailure? {
        for item in items.sorted(by: { $0.time < $1.time }) {
            if malfunctionStatuses.contains(item.status) { return .malfunction(item.status) }
            let exact = CMTimeSubtract(item.time, source.origin).seconds * params.rate.framesPerSecond
            guard exact.isFinite else { continue }
            let slot = Int(exact.rounded())
            if item.status == noErr, !item.dropped, item.image != nil {
                decoded += 1
                furthest = max(furthest, slot)
                // Every decoded picture, the pre-roll's too, sits within a quarter frame of its slot, as GridIndexer
                // checks it for decode.pass (IX2-F16); further off, FFmpeg's `fps` filter decides.
                if abs(exact - Double(slot)) > GridIndexer.slotTolerance {
                    return .offGrid(found: slot, expected: Int(exact.rounded(.up)))
                }
            }
            // Errors and drops before the window are the pre-roll's (a GOP's leading pictures).
            guard slot >= window.lowerBound else { continue }
            if item.status != noErr { return .decodeFailed(item.status) }
            guard !item.dropped, let image = item.image, slot <= window.upperBound else { continue }
            if case .failure(let failure) = outputs.accept(image, index: slot) { return failure }
            if wanted.contains(slot) { placed.insert(slot) }
        }
        return nil
    }
}
