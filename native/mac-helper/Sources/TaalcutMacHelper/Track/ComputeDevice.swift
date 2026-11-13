// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

enum ComputeKind: String, Sendable, Equatable {
    case neuralEngine
    case gpu
    case cpu
}

struct ComputeReport: Sendable, Equatable {
    var faces: ComputeKind = .gpu
    var humans: ComputeKind = .gpu
    var saliency: ComputeKind = .gpu
    var track: ComputeKind = .gpu
    /// FRM1: the person instance mask behind heads and the silhouette; nil until it has run.
    var silhouette: ComputeKind?

    var json: JSONValue {
        var parts: [String: JSONValue] = [
            "faces": .string(faces.rawValue),
            "humans": .string(humans.rawValue),
            "saliency": .string(saliency.rawValue),
            "track": .string(track.rawValue),
        ]
        if let silhouette { parts["silhouette"] = .string(silhouette.rawValue) }
        return .object(parts)
    }
}

struct LineLog: Sendable {
    var write: @Sendable (String) -> Void

    static let standard = LineLog { text in
        let line = text.hasSuffix("\n") ? text : text + "\n"
        FileHandle.standardError.write(Data(line.utf8))
    }
}

func chooseCompute(available: [ComputeKind]) -> ComputeKind {
    if available.contains(.neuralEngine) { return .neuralEngine }
    if !available.isEmpty, available.allSatisfy({ $0 == .cpu }) { return .cpu }
    return .gpu
}

func noteCPUFallback(which: String, reason: String, logged: inout Set<String>, log: LineLog) {
    guard logged.insert(which).inserted else { return }
    log.write("[track] CPU fallback \(which): \(reason)")
}
