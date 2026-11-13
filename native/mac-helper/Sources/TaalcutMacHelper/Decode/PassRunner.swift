// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import AVFoundation
import CoreMedia
import Foundation
import VideoToolbox

struct PassReport: Sendable {
    /// Grid frames written to the analysis output.
    let frames: Int
    /// Frames the decoder produced (pre-roll included).
    let decoded: Int
    let setFrames: [Int]
    let decodeMs: Int
}

/// One decode of the window, on the calling thread (it blocks): AVAssetReader hands compressed samples to a
/// VideoToolbox session of our own, which keeps several frames in flight (FFmpeg's hwaccel waits for each one).
/// Every path out of here, cancel and failure included, invalidates the session before returning.
func runPass(
    _ params: DecodePassParams, source: PassSource, cancel: PassCancel, progress: @escaping @Sendable (Double) -> Void
) -> Result<PassReport, PassFailure> {
    let started = DispatchTime.now()
    let reader: AVAssetReader
    do {
        reader = try AVAssetReader(asset: source.asset)
    } catch {
        return .failure(.unreadable(error.localizedDescription))
    }
    let output = AVAssetReaderTrackOutput(track: source.track, outputSettings: nil)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { return .failure(.unreadable("the reader refuses the track")) }
    reader.add(output)
    let session: VTDecompressionSession
    switch makeDecompressionSession(source) {
    case .success(let made): session = made
    case .failure(let failure): return .failure(failure)
    }
    let outputs: PassOutputs
    switch PassOutputs.open(params, source: source, cancel: cancel) {
    case .success(let opened): outputs = opened
    case .failure(let failure):
        VTDecompressionSessionInvalidate(session)
        return .failure(failure)
    }
    guard reader.startReading() else {
        VTDecompressionSessionInvalidate(session)
        outputs.close()
        return .failure(.unreadable(reader.error?.localizedDescription ?? "startReading failed"))
    }
    var loop = DecodeLoop(params: params, source: source, session: session, outputs: outputs, progress: progress)
    let failure = loop.run(output: output, cancel: cancel)
    if failure != nil || loop.stoppedEarly { reader.cancelReading() }
    if failure == nil {
        VTDecompressionSessionFinishDelayedFrames(session)
        VTDecompressionSessionWaitForAsynchronousFrames(session)
    }
    // A cancel or a failure drops what is still in flight; a finished pass has drained it.
    VTDecompressionSessionInvalidate(session)
    let late = failure == nil ? loop.process(loop.queue.drain()) : nil
    outputs.close()
    if let failure = failure ?? late { return .failure(failure) }
    if reader.status == .failed { return .failure(.unreadable(reader.error?.localizedDescription ?? "read failed")) }
    let ms = Int((DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000)
    return .success(PassReport(frames: loop.indexer.placed, decoded: loop.decoded, setFrames: outputs.setFrames, decodeMs: ms))
}

private struct DecodeLoop {
    let params: DecodePassParams
    let session: VTDecompressionSession
    let outputs: PassOutputs
    let progress: @Sendable (Double) -> Void
    let queue = DecodedFrames()
    var indexer: GridIndexer
    /// Frames shown before this time belong to the pre-roll: their errors and drops are not the window's.
    let windowStart: CMTime
    let expectedFrames: Int
    var decoded = 0
    var stoppedEarly = false

    init(
        params: DecodePassParams, source: PassSource, session: VTDecompressionSession, outputs: PassOutputs,
        progress: @escaping @Sendable (Double) -> Void
    ) {
        self.params = params
        self.session = session
        self.outputs = outputs
        self.progress = progress
        indexer = GridIndexer(origin: source.origin, rate: params.rate, window: params.window)
        let from = Double(params.window?.from ?? 0) - 0.5
        let seconds = max(0, from) / params.rate.framesPerSecond
        windowStart = CMTimeAdd(source.origin, CMTime(seconds: seconds, preferredTimescale: 90_000))
        expectedFrames = params.window?.frames ?? 0
    }

    /// Feeds samples until the end, a stop or a failure, from the last sync sample shown at or before the window.
    mutating func run(output: AVAssetReaderTrackOutput, cancel: PassCancel) -> PassFailure? {
        var preRoll = PreRoll(windowStart: params.window.map { $0.from > 0 } == true ? windowStart : nil)
        while !stoppedEarly, let sample = output.copyNextSampleBuffer() {
            if cancel.isCancelled { return .cancelled }
            guard CMSampleBufferGetNumSamples(sample) > 0 else { continue }
            for due in preRoll.admit(sample) {
                if let failure = queue.submit(due, to: session) { return failure }
            }
            if let failure = process(queue.drain()) { return failure }
        }
        return cancel.isCancelled ? .cancelled : nil
    }

    /// Places and writes decoded frames, in the display order the session returns them.
    mutating func process(_ items: [DecodedFrames.Item]) -> PassFailure? {
        for item in items where !stoppedEarly {
            if malfunctionStatuses.contains(item.status) { return .malfunction(item.status) }
            let inWindow = item.time >= windowStart
            if item.status != noErr {
                if inWindow { return .decodeFailed(item.status) }
                continue
            }
            // A dropped frame inside the window shows up as a gap on the grid.
            guard !item.dropped, let image = item.image else { continue }
            decoded += 1
            switch indexer.place(item.time) {
            case .before:
                continue
            case .after:
                stoppedEarly = true
            case .offGrid(let found, let expected):
                return .offGrid(found: found, expected: expected)
            case .frame(let index):
                if case .failure(let failure) = outputs.accept(image, index: index) { return failure }
                if expectedFrames > 0, indexer.placed % 30 == 0 {
                    progress(min(1, Double(indexer.placed) / Double(expectedFrames)))
                }
            }
        }
        return nil
    }
}

/// Samples before a window wait here from the last sync sample shown at or before its start, so the decoder starts
/// there instead of at the top of the file; from the first sample at or after the start, everything is due at once.
private struct PreRoll {
    /// Nil: no window to wait for (the whole file, or a window from frame 0).
    var windowStart: CMTime?
    private var held: [CMSampleBuffer] = []

    init(windowStart: CMTime?) {
        self.windowStart = windowStart
    }

    /// The samples to decode now, in order: none while before the window, the held ones and this one after.
    mutating func admit(_ sample: CMSampleBuffer) -> [CMSampleBuffer] {
        guard let start = windowStart else { return [sample] }
        if CMSampleBufferGetPresentationTimeStamp(sample) >= start {
            windowStart = nil
            defer { held.removeAll() }
            return held + [sample]
        }
        if isSyncSample(sample) { held.removeAll() }
        held.append(sample)
        return []
    }
}

private func isSyncSample(_ sample: CMSampleBuffer) -> Bool {
    guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]],
          let first = attachments.first
    else { return true }
    return !((first[kCMSampleAttachmentKey_NotSync] as? Bool) ?? false)
}
