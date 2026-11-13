// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

struct NormBox: Sendable, Equatable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    static let zero = NormBox(x: 0, y: 0, width: 0, height: 0)

    var area: Double { max(0, width) * max(0, height) }
    var center: FocusPoint { FocusPoint(x: x + width / 2, y: y + height / 2) }

    func contains(_ point: FocusPoint) -> Bool {
        point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height
    }

    /// A face that sits inside the person keeps that person's box. Rebuilding the
    /// union from edges drifts a decimal literal such as 0.38.
    func encloses(_ other: NormBox) -> Bool {
        other.x >= x && other.y >= y && other.x + other.width <= x + width
            && other.y + other.height <= y + height
    }

    func iou(_ other: NormBox) -> Double {
        let overlapW = max(0, min(x + width, other.x + other.width) - max(x, other.x))
        let overlapH = max(0, min(y + height, other.y + other.height) - max(y, other.y))
        let intersection = overlapW * overlapH
        let union = area + other.area - intersection
        if union <= 0 { return 0 }
        return intersection / union
    }

    func unioned(with other: NormBox) -> NormBox {
        let minX = min(x, other.x)
        let minY = min(y, other.y)
        let maxX = max(x + width, other.x + other.width)
        let maxY = max(y + height, other.y + other.height)
        return NormBox(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}

struct FocusPoint: Sendable, Equatable {
    var x: Double
    var y: Double
    static let zero = FocusPoint(x: 0, y: 0)
}

struct FocusAnchor: Sendable, Equatable {
    var fx: Double
    var fy: Double

    static func from(box: NormBox, focus: FocusPoint) -> FocusAnchor {
        guard box.width > 0, box.height > 0 else { return FocusAnchor(fx: 0.5, fy: 0.5) }
        return FocusAnchor(fx: (focus.x - box.x) / box.width, fy: (focus.y - box.y) / box.height)
    }

    func point(in box: NormBox) -> FocusPoint {
        FocusPoint(x: box.x + fx * box.width, y: box.y + fy * box.height)
    }
}

struct DetectedFace: Sendable, Equatable {
    var box: NormBox
    var confidence: Double
    var roll: Double
    var yaw: Double
    var pitch: Double
}

struct DetectedRegion: Sendable, Equatable {
    var box: NormBox
    var confidence: Double
}

enum SubjectKind: String, Sendable {
    case face
    case human
    case union
    case saliency
    case track
    case none
}

struct SubjectChoice: Sendable, Equatable {
    var kind: SubjectKind
    var box: NormBox
    var focus: FocusPoint
    var confidence: Double

    static let none = SubjectChoice(kind: .none, box: .zero, focus: .zero, confidence: 0)
}

private struct PersonCandidate {
    var kind: SubjectKind
    var box: NormBox
    var focus: FocusPoint
    var confidence: Double
}

func chooseSubject(
    faces: [DetectedFace], humans: [DetectedRegion], saliency: [DetectedRegion], previous: NormBox?
) -> SubjectChoice {
    var usedHumans = Set<Int>()
    var candidates: [PersonCandidate] = []
    for face in faces {
        let focus = face.box.center
        var match: (Int, DetectedRegion)?
        for (index, human) in humans.enumerated() {
            let paired = human.box.contains(focus) || face.box.iou(human.box) > 0
            if paired, match == nil || human.confidence > match?.1.confidence ?? -1 {
                match = (index, human)
            }
        }
        if let match {
            usedHumans.insert(match.0)
            let humanBox = match.1.box
            let box = humanBox.encloses(face.box) ? humanBox : face.box.unioned(with: humanBox)
            candidates.append(PersonCandidate(
                kind: .union, box: box, focus: focus, confidence: match.1.confidence))
        } else {
            candidates.append(PersonCandidate(kind: .face, box: face.box, focus: focus, confidence: face.confidence))
        }
    }
    for (index, human) in humans.enumerated() where !usedHumans.contains(index) {
        candidates.append(PersonCandidate(kind: .human, box: human.box, focus: human.box.center, confidence: human.confidence))
    }
    if let chosen = pick(candidates, previous: previous) {
        return SubjectChoice(kind: chosen.kind, box: chosen.box, focus: chosen.focus, confidence: chosen.confidence)
    }
    if let spot = pick(saliency.map {
        PersonCandidate(kind: .saliency, box: $0.box, focus: $0.box.center, confidence: $0.confidence)
    }, previous: nil) {
        return SubjectChoice(kind: .saliency, box: spot.box, focus: spot.focus, confidence: spot.confidence)
    }
    return .none
}

enum TrackStep: Sendable, Equatable {
    case keep
    case drop
    case reseed
}

func trackStep(confidence: Double, iou: Double, hasDetection: Bool) -> TrackStep {
    if confidence < 0.3 { return .drop }
    if !hasDetection { return .keep }
    if iou >= 0.5 { return .keep }
    return .reseed
}

enum SampleRole: String, Sendable {
    case detect
    case track
}

struct RoleCursor: Sendable {
    private var nextDetect: Double
    private var nextTrack: Double
    private let start: Double
    private let end: Double
    private let detectGap: Double
    private let trackGap: Double

    init(start: Double, end: Double, detectHz: Double, trackHz: Double) {
        self.start = start
        self.end = end
        self.detectGap = detectHz > 0 ? 1 / detectHz : 0
        self.trackGap = trackHz > 0 ? 1 / trackHz : 0
        self.nextDetect = start
        self.nextTrack = start + self.trackGap
    }

    mutating func role(at stamp: Double) -> SampleRole? {
        if detectGap <= 0 || end <= start { return nil }
        if stamp < start || stamp >= end { return nil }
        if stamp + 0.0001 >= nextDetect {
            nextDetect += detectGap
            if trackGap > 0 {
                while nextTrack <= stamp + 0.0001 { nextTrack += trackGap }
            }
            return .detect
        }
        if trackGap > 0, stamp + 0.0001 >= nextTrack {
            nextTrack += trackGap
            return .track
        }
        return nil
    }
}

func sampleRoles(start: Double, end: Double, detectHz: Double, trackHz: Double, stamps: [Double]) -> [SampleRole?] {
    var cursor = RoleCursor(start: start, end: end, detectHz: detectHz, trackHz: trackHz)
    return stamps.map { cursor.role(at: $0) }
}

private func pick(_ candidates: [PersonCandidate], previous: NormBox?) -> PersonCandidate? {
    guard !candidates.isEmpty else { return nil }
    if let previous {
        let scored = candidates.map { ($0, $0.box.iou(previous)) }
        let best = scored.map(\.1).max() ?? 0
        if best > 0 {
            return scored.filter { $0.1 == best }.map(\.0).max(by: lessConfident)
        }
    }
    return candidates.max(by: lessConfident)
}

private func lessConfident(_ lhs: PersonCandidate, _ rhs: PersonCandidate) -> Bool {
    if lhs.confidence != rhs.confidence { return lhs.confidence < rhs.confidence }
    return lhs.box.area < rhs.box.area
}
