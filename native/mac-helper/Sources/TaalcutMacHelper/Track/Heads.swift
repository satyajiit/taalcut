// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// FRM1: whole-head boxes, hair and headwear included: the hard keep-out for graphics.
/// - A face's head is its rectangle widened by proportions measured on the labelled fixture set (render SPEC
///   FRM1-SUB): wider, taller and reaching further behind the face as it turns side-on, and rotated with the face's
///   roll.
/// - An upper body Vision finds without a face on it (the back of a head, a face turned away) gets a head at its top.
/// - A body pose with ears (or eyes and nose) and a neck or shoulders, and no head yet where its head is, gets one
///   sized from the ears' height over the neck and the shoulders' width (`headOfPose`).
/// The person mask is not used for heads: on real footage it bleeds into the background, and every rule tried with
/// it (raising the top to the hair, widening at the temples, a dome at the top of a person) lost more heads than it
/// found. Boxes are worked out in top-left space and returned in Vision's lower-left space, like every other box.
enum HeadProportions {
    /// Head width, height and the head's top above the face's, in face widths and heights: `base + turned * |t|`,
    /// where t is the yaw over a quarter turn (1 is a full profile).
    static let width = (base: 1.25, turned: 0.8)
    static let height = (base: 1.75, turned: 0.8)
    static let lift = (base: 0.7, turned: 0.6)
    /// How far the head's centre sits behind the face's at a full profile, in face widths.
    static let turnShift = 0.6
    /// Below this roll (radians) the head isn't rotated.
    static let minRoll = 0.15
    /// An upper-body head: this share of the body's height, at most this share of its width, and its height over its
    /// width (in pixels) between these.
    static let upperShare = 0.3
    static let upperWidth = 0.8
    static let upperMinAspect = 1 / 1.2
    static let upperMaxAspect = 1.6
    /// A pose head: joints at or above this confidence; its height this many times the ears' height over the neck,
    /// at least the shoulders' width over `poseShoulders`, grown by `poseGrow`; its top `poseTop` of its height above
    /// the ears; its pixel width `poseWidth` of its height.
    static let poseConfidence = 0.2
    static let poseNeck = 1.4
    static let poseShoulders = 1.25
    static let poseGrow = 1.2
    static let poseTop = 0.55
    static let poseWidth = 0.9
}

/// A body-pose joint, top-left space.
struct PoseJoint: Sendable, Equatable {
    var x: Double
    var y: Double
    var confidence: Double
}

/// The joints of one body pose that place a head.
struct PoseJoints: Sendable, Equatable {
    var ears: [PoseJoint] = []
    /// Eyes and nose.
    var face: [PoseJoint] = []
    var neck: PoseJoint?
    var leftShoulder: PoseJoint?
    var rightShoulder: PoseJoint?
}

struct HeadsAndPeople: Sendable {
    var heads: [DetectedRegion]
    var people: [DetectedRegion]
}

/// Top-left normalised box.
struct TLBox: Equatable {
    var x0: Double
    var y0: Double
    var x1: Double
    var y1: Double

    init(x0: Double, y0: Double, x1: Double, y1: Double) {
        self.x0 = x0
        self.y0 = y0
        self.x1 = x1
        self.y1 = y1
    }

    init(lowerLeft box: NormBox) {
        self.init(x0: box.x, y0: 1 - box.y - box.height, x1: box.x + box.width, y1: 1 - box.y)
    }

    var width: Double { x1 - x0 }
    var height: Double { y1 - y0 }
    var cx: Double { (x0 + x1) / 2 }
    var cy: Double { (y0 + y1) / 2 }
    var area: Double { max(0, width) * max(0, height) }

    var clamped: TLBox {
        TLBox(x0: min(1, max(0, x0)), y0: min(1, max(0, y0)), x1: min(1, max(0, x1)), y1: min(1, max(0, y1)))
    }
    var lowerLeft: NormBox { NormBox(x: x0, y: 1 - y1, width: width, height: height) }

    func overlap(_ other: TLBox) -> Double {
        let w = min(x1, other.x1) - max(x0, other.x0)
        let h = min(y1, other.y1) - max(y0, other.y0)
        return w > 0 && h > 0 ? w * h : 0
    }
    func union(_ other: TLBox) -> TLBox {
        TLBox(x0: min(x0, other.x0), y0: min(y0, other.y0), x1: max(x1, other.x1), y1: max(y1, other.y1))
    }
}

/// `uppers` are Vision's upper-body rectangles, `humans` its whole-body ones; `frameAspect` is the frame's width
/// over its height. `mask` only adds people Vision's rectangles missed.
func findHeads(
    faces: [DetectedFace], uppers: [DetectedRegion], humans: [DetectedRegion], poses: [PoseJoints] = [],
    mask: PersonMask?, frameAspect: Double
) -> HeadsAndPeople {
    var heads: [(box: TLBox, confidence: Double)] = faces.map {
        (headOfFace(TLBox(lowerLeft: $0.box), yaw: $0.yaw, roll: $0.roll, frameAspect: frameAspect).clamped,
         $0.confidence)
    }
    for upper in uppers {
        let body = TLBox(lowerLeft: upper.box)
        // A face head in the body's top half is this person's head.
        let top = TLBox(x0: body.x0, y0: body.y0, x1: body.x1, y1: body.y0 + body.height / 2)
        if heads.contains(where: { $0.box.overlap(top) > 0.4 * $0.box.area }) { continue }
        let head = headOfUpperBody(body, frameAspect: frameAspect).clamped
        if heads.contains(where: { $0.box.overlap(head) > 0.3 * min($0.box.area, head.area) }) { continue }
        heads.append((head, upper.confidence * 0.8))
    }
    // A pose's head where no face or upper body put one: the back of a head with its ears and shoulders found.
    for pose in poses {
        guard let placed = headOfPose(pose, frameAspect: frameAspect) else { continue }
        let head = placed.box.clamped
        if heads.contains(where: { $0.box.overlap(head) > 0.3 * min($0.box.area, head.area) }) { continue }
        heads.append((head, placed.confidence * 0.8))
    }
    // Bodies are Vision's whole-body rectangles, then its upper bodies; a masked person without either gets the box
    // of their pixels.
    var bodies: [(box: TLBox, confidence: Double)] = []
    for region in humans + uppers {
        let box = TLBox(lowerLeft: region.box)
        if bodies.contains(where: { $0.box.overlap(box) > 0.6 * min($0.box.area, box.area) }) { continue }
        bodies.append((box, region.confidence))
    }
    if let mask {
        for rows in personRows(mask) {
            let box = TLBox(
                x0: Double(rows.minX) / Double(mask.width), y0: Double(rows.top) / Double(mask.height),
                x1: Double(rows.maxX + 1) / Double(mask.width), y1: Double(rows.bottom + 1) / Double(mask.height))
            if bodies.contains(where: { $0.box.overlap(box) > 0.3 * min($0.box.area, box.area) }) { continue }
            bodies.append((box, 0.6))
        }
    }
    // Each body reaches over its head.
    for index in bodies.indices {
        for head in heads where bodies[index].box.overlap(head.box) > 0.5 * head.box.area {
            bodies[index].box = bodies[index].box.union(head.box)
        }
    }
    return HeadsAndPeople(
        heads: heads.prefix(16).map { DetectedRegion(box: $0.box.lowerLeft, confidence: $0.confidence) },
        people: bodies.prefix(16).map { DetectedRegion(box: $0.box.clamped.lowerLeft, confidence: $0.confidence) })
}

/// The face rectangle widened to the whole head. Turned side-on, the head is wider and taller around the face and
/// reaches further behind it (positive yaw puts the back of the head on the picture's left); rolled, it tilts with
/// the face.
func headOfFace(_ face: TLBox, yaw: Double, roll: Double, frameAspect: Double) -> TLBox {
    let turned = max(-1, min(1, yaw / (Double.pi / 2)))
    let side = abs(turned)
    let p = HeadProportions.self
    let width = face.width * (p.width.base + p.width.turned * side)
    let height = face.height * (p.height.base + p.height.turned * side)
    let cx = face.cx - p.turnShift * turned * face.width
    let top = face.y0 - (p.lift.base + p.lift.turned * side) * face.height
    let head = TLBox(x0: cx - width / 2, y0: top, x1: cx + width / 2, y1: top + height)
    guard abs(roll) > p.minRoll else { return head }
    // Rotate the corners about the face's centre in pixel proportions, then take their bounds.
    let corners = [(head.x0, head.y0), (head.x1, head.y0), (head.x0, head.y1), (head.x1, head.y1)]
    let turnedCorners = corners.map { corner -> (Double, Double) in
        let dx = (corner.0 - face.cx) * frameAspect
        let dy = corner.1 - face.cy
        let rx = dx * cos(roll) + dy * sin(roll)
        let ry = -dx * sin(roll) + dy * cos(roll)
        return (face.cx + rx / frameAspect, face.cy + ry)
    }
    return TLBox(
        x0: turnedCorners.map(\.0).min()!, y0: turnedCorners.map(\.1).min()!,
        x1: turnedCorners.map(\.0).max()!, y1: turnedCorners.map(\.1).max()!)
}

/// A head at the top of an upper body: a share of its height, centred, no wider than the body.
func headOfUpperBody(_ body: TLBox, frameAspect: Double) -> TLBox {
    let p = HeadProportions.self
    let height = p.upperShare * body.height
    // Widths in frame-width units for a pixel aspect (height over width) of the head.
    let widthFor = { (aspect: Double) in height / aspect / frameAspect }
    let width = max(min(p.upperWidth * body.width, widthFor(p.upperMinAspect)), widthFor(p.upperMaxAspect))
    return TLBox(x0: body.cx - width / 2, y0: body.y0, x1: body.cx + width / 2, y1: body.y0 + height)
}

/// A head from a body pose: centred on the ears (or the eyes and nose), its height from the ears' height over the
/// neck and the shoulders' width, its top above the ears. Nil without a head joint or anything to size it by.
func headOfPose(_ pose: PoseJoints, frameAspect: Double) -> (box: TLBox, confidence: Double)? {
    let p = HeadProportions.self
    let ears = pose.ears.filter { $0.confidence >= p.poseConfidence }
    let face = pose.face.filter { $0.confidence >= p.poseConfidence }
    let anchor = ears.isEmpty ? face : ears
    guard !anchor.isEmpty else { return nil }
    let ax = anchor.map(\.x).reduce(0, +) / Double(anchor.count)
    let ay = anchor.map(\.y).reduce(0, +) / Double(anchor.count)
    var height: Double?
    if let neck = pose.neck, neck.confidence >= p.poseConfidence, neck.y > ay { height = p.poseNeck * (neck.y - ay) }
    if let left = pose.leftShoulder, let right = pose.rightShoulder,
        left.confidence >= p.poseConfidence, right.confidence >= p.poseConfidence
    {
        // The shoulders' width in frame heights, over a typical shoulders-to-head ratio.
        let byShoulders = abs(left.x - right.x) * frameAspect / p.poseShoulders
        height = max(height ?? 0, byShoulders)
    }
    guard let found = height, found > 0 else { return nil }
    let grown = found * p.poseGrow
    let width = p.poseWidth * grown / frameAspect
    let top = ay - p.poseTop * grown
    let confidence = anchor.map(\.confidence).reduce(0, +) / Double(anchor.count)
    return (TLBox(x0: ax - width / 2, y0: top, x1: ax + width / 2, y1: top + grown), min(1, confidence))
}
