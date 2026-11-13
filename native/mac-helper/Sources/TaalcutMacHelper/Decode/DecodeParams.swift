// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Frames per second as a ratio (the analysis grid, e.g. 30000/1001).
struct GridRate: Sendable, Equatable {
    let num: Int64
    let den: Int64

    var framesPerSecond: Double { Double(num) / Double(den) }
}

/// Grid frames `[from, from + frames)` of the whole file (one segment of a long one).
struct PassWindow: Sendable, Equatable {
    let from: Int
    let frames: Int
}

enum FrameSetFormat: String, Sendable {
    case rgb24
    case gray8
}

/// Every `every`-th grid frame of the window at one size, appended to `path`, at most `maxFrames` of them.
struct FrameSetOutput: Sendable, Equatable {
    let width: Int
    let height: Int
    let every: Int
    let maxFrames: Int
    let format: FrameSetFormat
    let path: URL
}

/// Every grid frame at the analysis size, as tightly packed NV12, written to `path` (a FIFO or a file).
struct AnalysisOutput: Sendable, Equatable {
    let width: Int
    let height: Int
    let path: URL
}

struct DecodePassParams: Sendable {
    let source: URL
    let rate: GridRate
    let window: PassWindow?
    /// Clockwise degrees that turn the stored picture upright (the plan's rotation).
    let rotation: Int
    let analysis: AnalysisOutput
    let sets: [FrameSetOutput]
    /// The range the caller tagged the analysis frames with (`full` or `video`): a stream of the other range is
    /// declined before any frame is written. Absent: either.
    let fullRange: Bool?
}

private let maxSide = 8192
private let maxSets = 8

/// `decode.pass` params, validated; every path confined to an allowed root.
func parseDecodePass(_ params: JSONValue, confinement: PathConfinement) -> Result<DecodePassParams, HelperFailure> {
    guard let object = params.object else { return .failure(.badRequest("params must be an object")) }
    guard let path = object["path"]?.string else { return .failure(.badRequest("path is required")) }
    let source: URL
    switch confinement.resolve(path) {
    case .success(let url): source = url
    case .failure(let failure): return .failure(failure)
    }
    guard let rate = gridRate(object["rate"]) else { return .failure(.badRequest("rate wants {num, den}, both 1 to 1000000")) }
    // A checked conversion: `Int(1e20)` would stop the process, and every session it holds with it.
    let asked = object["rotation"] == nil ? 0 : whole(object["rotation"])
    guard let rotation = asked, [0, 90, 180, 270].contains(rotation) else {
        return .failure(.badRequest("rotation is 0, 90, 180 or 270"))
    }
    var fullRange: Bool?
    if let range = object["range"] {
        guard let name = range.string, name == "full" || name == "video" else {
            return .failure(.badRequest("range is full or video"))
        }
        fullRange = name == "full"
    }
    var window: PassWindow?
    if let value = object["window"] {
        guard let from = wholeNumber(value.key("from"), min: 0), let frames = wholeNumber(value.key("frames"), min: 1) else {
            return .failure(.badRequest("window wants {from >= 0, frames >= 1}"))
        }
        window = PassWindow(from: from, frames: frames)
    }
    guard let analysisValue = object["analysis"] else { return .failure(.badRequest("analysis is required")) }
    let analysis: AnalysisOutput
    switch analysisOutput(analysisValue, confinement: confinement) {
    case .success(let output): analysis = output
    case .failure(let failure): return .failure(failure)
    }
    let setValues = object["sets"]?.array ?? []
    guard setValues.count <= maxSets else { return .failure(.badRequest("at most \(maxSets) frame sets")) }
    var sets: [FrameSetOutput] = []
    for value in setValues {
        switch frameSet(value, confinement: confinement) {
        case .success(let set): sets.append(set)
        case .failure(let failure): return .failure(failure)
        }
    }
    return .success(DecodePassParams(
        source: source, rate: rate, window: window, rotation: rotation, analysis: analysis, sets: sets,
        fullRange: fullRange))
}

private func wholeNumber(_ value: JSONValue?, min: Int, max: Int = Int(Int32.max)) -> Int? {
    guard let number = whole(value), number >= min, number <= max else { return nil }
    return number
}

private func gridRate(_ value: JSONValue?) -> GridRate? {
    guard let num = wholeNumber(value?.key("num"), min: 1, max: 1_000_000),
          let den = wholeNumber(value?.key("den"), min: 1, max: 1_000_000)
    else { return nil }
    return GridRate(num: Int64(num), den: Int64(den))
}

private func confined(_ value: JSONValue?, _ confinement: PathConfinement) -> Result<URL, HelperFailure> {
    guard let path = value?.string else { return .failure(.badRequest("an output path is required")) }
    return confinement.resolve(path)
}

private func analysisOutput(_ value: JSONValue, confinement: PathConfinement) -> Result<AnalysisOutput, HelperFailure> {
    // NV12 needs even sides: its chroma plane is half the size each way.
    guard let width = wholeNumber(value.key("width"), min: 2, max: maxSide), width % 2 == 0,
          let height = wholeNumber(value.key("height"), min: 2, max: maxSide), height % 2 == 0
    else { return .failure(.badRequest("analysis wants even width and height, 2 to \(maxSide)")) }
    return confined(value.key("path"), confinement).map { AnalysisOutput(width: width, height: height, path: $0) }
}

private func frameSet(_ value: JSONValue, confinement: PathConfinement) -> Result<FrameSetOutput, HelperFailure> {
    guard let width = wholeNumber(value.key("width"), min: 1, max: maxSide),
          let height = wholeNumber(value.key("height"), min: 1, max: maxSide),
          let every = wholeNumber(value.key("every"), min: 1),
          let maxFrames = wholeNumber(value.key("maxFrames"), min: 0),
          let format = value.key("format")?.string.flatMap(FrameSetFormat.init(rawValue:))
    else { return .failure(.badRequest("a frame set wants width, height, every >= 1, maxFrames >= 0, format rgb24|gray8")) }
    return confined(value.key("path"), confinement).map {
        FrameSetOutput(width: width, height: height, every: every, maxFrames: maxFrames, format: format, path: $0)
    }
}
