// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreMedia
import Foundation

struct TrackSample: Sendable, Equatable {
    var time: CMTime
    var source: SampleRole
    var faces: [DetectedFace]
    var humans: [DetectedRegion]
    var saliency: [DetectedRegion]
    var subject: SubjectChoice
    /// FRM1: on detect samples only.
    var heads: [DetectedRegion]? = nil
    var people: [DetectedRegion]? = nil
    var silhouette: SilhouetteGrid? = nil
}

struct TrackDocument: Sendable {
    var width: Int
    var height: Int
    var compute: ComputeReport
    var samples: [TrackSample]
    var decodeMs: Int
    var detectMs: Int
    var trackMs: Int

    var json: JSONValue {
        .object([
            "api": .string("Vision"),
            "boxSpace": .string("normalized-lower-left"),
            "width": .number(Double(width)),
            "height": .number(Double(height)),
            "compute": compute.json,
            "samples": .array(samples.map(\.json)),
            "ms": .object([
                "decode": .number(Double(decodeMs)),
                "detect": .number(Double(detectMs)),
                "track": .number(Double(trackMs)),
            ]),
        ])
    }
}

extension TrackSample {
    var json: JSONValue {
        var parts: [String: JSONValue] = [
            "t": .object([
                "value": .number(Double(time.value)),
                "rate": .number(Double(time.timescale)),
            ]),
            "source": .string(source.rawValue),
            "faces": .array(faces.map(faceJSON)),
            "humans": .array(humans.map(regionJSON)),
            "saliency": .array(saliency.map(regionJSON)),
            "subject": subjectJSON(subject),
        ]
        if let heads { parts["heads"] = .array(heads.map(regionJSON)) }
        if let people { parts["people"] = .array(people.map(regionJSON)) }
        if let silhouette {
            parts["silhouette"] = .object([
                "cols": .number(Double(silhouette.cols)),
                "rows": .number(Double(silhouette.rows)),
                "bits": .string(silhouette.bits),
            ])
        }
        return .object(parts)
    }
}

private func faceJSON(_ face: DetectedFace) -> JSONValue {
    .object([
        "box": boxJSON(face.box),
        "confidence": .number(face.confidence),
        "roll": .number(face.roll),
        "yaw": .number(face.yaw),
        "pitch": .number(face.pitch),
    ])
}

private func regionJSON(_ region: DetectedRegion) -> JSONValue {
    .object([
        "box": boxJSON(region.box),
        "confidence": .number(region.confidence),
    ])
}

private func subjectJSON(_ subject: SubjectChoice) -> JSONValue {
    .object([
        "kind": .string(subject.kind.rawValue),
        "box": boxJSON(subject.box),
        "focus": .object(["x": .number(subject.focus.x), "y": .number(subject.focus.y)]),
        "confidence": .number(subject.confidence),
    ])
}

private func boxJSON(_ box: NormBox) -> JSONValue {
    .object([
        "x": .number(box.x),
        "y": .number(box.y),
        "width": .number(box.width),
        "height": .number(box.height),
    ])
}

func milliseconds(since start: ContinuousClock.Instant, clock: ContinuousClock = .init()) -> Int {
    let elapsed = clock.now - start
    let seconds = elapsed.components.seconds
    let fraction = elapsed.components.attoseconds / 1_000_000_000_000_000
    let total = seconds * 1000 + fraction
    return Int(total)
}
