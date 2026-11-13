// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// `decode.pass`: one VideoToolbox decode of a video (or a window of it) into the analysis pass's outputs. The
/// decode runs on its own thread (AVAssetReader and the frame writes block); a cancel sets a flag the loop reads
/// between samples, and the reply is sent only after the session is invalidated, so the process never has to be
/// killed to end a session.
func decodePass(
    params: JSONValue, progress: @escaping @Sendable (Double) -> Void, confinement: PathConfinement
) async -> WorkResponse {
    await serveDecode("decode.pass", parseDecodePass(params, confinement: confinement)) { request, source, cancel in
        runPass(request, source: source, cancel: cancel, progress: progress)
    } reply: { report, source in
        .object([
            "frames": .number(Double(report.frames)),
            "decoded": .number(Double(report.decoded)),
            "sets": .array(report.setFrames.map { .number(Double($0)) }),
            "fullRange": .bool(source.fullRange),
            "pixelFormat": .string(source.fullRange ? "420f" : "420v"),
            "ms": .number(Double(report.decodeMs)),
        ])
    }
}

/// What a decode request names before it runs: its file, and the range the caller will tag the frames with.
protocol DecodeRequestParams: Sendable {
    var source: URL { get }
    var fullRange: Bool? { get }
}

extension DecodePassParams: DecodeRequestParams {}
extension DecodeFramesParams: DecodeRequestParams {}

/// What `decode.pass` and `decode.frames` (IX2-G3) share: the params as parsed (a bad request answered at once), the
/// source opened, the range checked before any frame, the decode run on a thread of its own (it blocks on
/// VideoToolbox) with a cancel flag that a task cancel sets and the decode reads between samples, and the reply built
/// from its report, or its failure. The decode invalidates its session before it returns, so no reply goes out with
/// a session open.
func serveDecode<Params: DecodeRequestParams, Report: Sendable>(
    _ name: String, _ parsed: Result<Params, HelperFailure>,
    run: @escaping @Sendable (Params, PassSource, PassCancel) -> Result<Report, PassFailure>,
    reply: (Report, PassSource) -> JSONValue
) async -> WorkResponse {
    let request: Params
    switch parsed {
    case .success(let params): request = params
    case .failure(let failure): return .fail(failure)
    }
    let source: PassSource
    switch await PassSource.open(request.source) {
    case .success(let opened): source = opened
    case .failure(let failure): return .fail(failure.helperFailure)
    }
    if let expected = request.fullRange, expected != source.fullRange {
        let found = source.fullRange ? "full" : "video"
        return .fail(PassFailure.unsupported("the stream is \(found) range, not the range asked for").helperFailure)
    }
    let cancel = PassCancel()
    let result = await withTaskCancellationHandler {
        await withCheckedContinuation { (done: CheckedContinuation<Result<Report, PassFailure>, Never>) in
            let thread = Thread { done.resume(returning: run(request, source, cancel)) }
            thread.name = name
            thread.qualityOfService = .userInitiated
            thread.start()
        }
    } onCancel: {
        cancel.cancel()
    }
    switch result {
    case .success(let report): return .ok(reply(report, source))
    case .failure(let failure): return .fail(failure.helperFailure)
    }
}

extension PassFailure {
    /// Codes the TypeScript route reads: `unsupported`, `off_grid` and `session_malfunction` send the file to FFmpeg.
    var helperFailure: HelperFailure {
        switch self {
        case .unreadable(let message):
            return .failed("decode.unreadable", message, retryable: false)
        case .unsupported(let message):
            return .failed("decode.unsupported", message, retryable: false)
        case .malfunction(let status):
            return .failed(
                "decode.session_malfunction", "VideoToolbox status \(status)", retryable: false,
                detail: .object(["status": .number(Double(status))]))
        case .decodeFailed(let status):
            return .failed(
                "decode.failed", "VideoToolbox status \(status)", retryable: true,
                detail: .object(["status": .number(Double(status))]))
        case .offGrid(let found, let expected):
            return .failed(
                "decode.off_grid", "frame \(found) where \(expected) was due", retryable: false,
                detail: .object(["found": .number(Double(found)), "expected": .number(Double(expected))]))
        case .outputClosed(let message):
            return .failed("decode.output_closed", message, retryable: true)
        case .cancelled:
            return .cancelled
        case .failed(let message):
            return .failed("decode.failed", message, retryable: true)
        }
    }
}
