// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// `decode.frames`: explicit grid frames of one video, at one or more sizes, from one VideoToolbox session (IX2-G3),
/// where FFmpeg would start one process and one session per seek window. Like `decode.pass`, the decode runs on its
/// own thread, a cancel is a flag read between samples, and the reply goes only after the session is invalidated.
func decodeFrames(
    params: JSONValue, progress: @escaping @Sendable (Double) -> Void, confinement: PathConfinement
) async -> WorkResponse {
    await serveDecode("decode.frames", parseDecodeFrames(params, confinement: confinement)) { request, source, cancel in
        runFrames(request, source: source, cancel: cancel, progress: progress)
    } reply: { report, source in
        .object([
            "written": .array(report.written.map { .array($0.map { .number(Double($0)) }) }),
            "decoded": .number(Double(report.decoded)),
            "reads": .number(Double(report.reads)),
            "fullRange": .bool(source.fullRange),
            "ms": .number(Double(report.decodeMs)),
        ])
    }
}
