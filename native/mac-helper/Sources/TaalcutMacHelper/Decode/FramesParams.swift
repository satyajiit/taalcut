// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Grid frames of one size, written as packed NV12 to `path` in ascending frame order (frames past the end are
/// left out; the reply says which were written).
struct FramesSetOutput: Sendable, Equatable {
    let width: Int
    let height: Int
    /// Ascending, distinct grid frames.
    let frames: [Int]
    let path: URL
}

/// `decode.frames`: explicit grid frames of one video at one or more sizes, from one VideoToolbox session. Frames
/// closer than `gapSeconds` share one read from the sync sample before them (FFmpeg's seek windows,
/// decode-frame-sets.ts), so a read never decodes more of the file than the seeks it replaces.
struct DecodeFramesParams: Sendable {
    let source: URL
    let rate: GridRate
    /// Clockwise degrees that turn the stored picture upright (the plan's rotation).
    let rotation: Int
    let gapSeconds: Double
    let sets: [FramesSetOutput]
    /// The range the caller will tag the frames with: a stream of the other range is declined. Absent: either.
    let fullRange: Bool?

    /// Every frame some set asks for, ascending.
    var wanted: [Int] { Array(Set(sets.flatMap(\.frames))).sorted() }
}

private let maxSide = 8192
private let maxSets = 8
private let maxFrames = 100_000

/// `decode.frames` params, validated; every path confined to an allowed root.
func parseDecodeFrames(_ params: JSONValue, confinement: PathConfinement) -> Result<DecodeFramesParams, HelperFailure> {
    guard let object = params.object else { return .failure(.badRequest("params must be an object")) }
    guard let path = object["path"]?.string else { return .failure(.badRequest("path is required")) }
    let source: URL
    switch confinement.resolve(path) {
    case .success(let url): source = url
    case .failure(let failure): return .failure(failure)
    }
    guard let num = whole(object["rate"]?.key("num")), let den = whole(object["rate"]?.key("den")),
          (1 ... 1_000_000).contains(num), (1 ... 1_000_000).contains(den)
    else { return .failure(.badRequest("rate wants {num, den}, both 1 to 1000000")) }
    // A checked conversion: `Int(1e20)` would stop the process, and every session it holds with it.
    let asked = object["rotation"] == nil ? 0 : whole(object["rotation"])
    guard let rotation = asked, [0, 90, 180, 270].contains(rotation) else {
        return .failure(.badRequest("rotation is 0, 90, 180 or 270"))
    }
    let gap = object["gapSeconds"]?.number ?? 2
    guard gap.isFinite, gap >= 0, gap <= 3600 else { return .failure(.badRequest("gapSeconds is 0 to 3600")) }
    var fullRange: Bool?
    if let range = object["range"] {
        guard let name = range.string, name == "full" || name == "video" else {
            return .failure(.badRequest("range is full or video"))
        }
        fullRange = name == "full"
    }
    let values = object["sets"]?.array ?? []
    guard (1 ... maxSets).contains(values.count) else { return .failure(.badRequest("1 to \(maxSets) frame sets")) }
    var sets: [FramesSetOutput] = []
    for value in values {
        switch framesSet(value, confinement: confinement) {
        case .success(let set): sets.append(set)
        case .failure(let failure): return .failure(failure)
        }
    }
    return .success(DecodeFramesParams(
        source: source, rate: GridRate(num: Int64(num), den: Int64(den)), rotation: rotation, gapSeconds: gap,
        sets: sets, fullRange: fullRange))
}

private func framesSet(_ value: JSONValue, confinement: PathConfinement) -> Result<FramesSetOutput, HelperFailure> {
    // NV12 needs even sides: its chroma plane is half the size each way.
    guard let width = whole(value.key("width")), (2 ... maxSide).contains(width), width % 2 == 0,
          let height = whole(value.key("height")), (2 ... maxSide).contains(height), height % 2 == 0
    else { return .failure(.badRequest("a frame set wants even width and height, 2 to \(maxSide)")) }
    guard let list = value.key("frames")?.array, (1 ... maxFrames).contains(list.count) else {
        return .failure(.badRequest("a frame set wants 1 to \(maxFrames) frames"))
    }
    var frames: [Int] = []
    for item in list {
        guard let frame = whole(item), frame >= 0, frame <= Int(Int32.max), frames.last.map({ frame > $0 }) ?? true else {
            return .failure(.badRequest("frames are ascending, distinct grid frames"))
        }
        frames.append(frame)
    }
    guard let path = value.key("path")?.string else { return .failure(.badRequest("a frame set wants a path")) }
    return confinement.resolve(path).map { FramesSetOutput(width: width, height: height, frames: frames, path: $0) }
}
