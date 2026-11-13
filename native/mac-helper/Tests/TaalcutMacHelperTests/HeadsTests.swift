// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

/// FRM1-SUB: whole heads from faces and upper bodies (Heads.swift); boxes in Vision's lower-left space.
@Suite struct HeadsTests {
    private func face(_ x: Double, _ y: Double, _ w: Double, _ h: Double, yaw: Double = 0, roll: Double = 0)
        -> DetectedFace
    {
        DetectedFace(box: NormBox(x: x, y: y, width: w, height: h), confidence: 0.9, roll: roll, yaw: yaw, pitch: 0)
    }

    @Test func aFrontalFaceGrowsToTheWholeHeadAroundIt() {
        // Top-left: face x 0.4–0.5, y 0.3–0.45.
        let found = findHeads(
            faces: [face(0.4, 0.55, 0.1, 0.15)], uppers: [], humans: [], mask: nil, frameAspect: 9 / 16)
        #expect(found.heads.count == 1)
        let head = TLBox(lowerLeft: found.heads[0].box)
        #expect(abs(head.cx - 0.45) < 1e-9)
        #expect(abs(head.width - 0.125) < 1e-9)
        #expect(abs(head.height - 0.2625) < 1e-9)
        // The hair above the face: 0.7 face heights.
        #expect(abs(head.y0 - (0.3 - 0.105)) < 1e-9)
        #expect(head.y0 < 0.3 && head.y1 > 0.45)
    }

    @Test func aTurnedFaceReachesBehindItself() {
        // Positive yaw: the back of the head on the picture's left.
        let profile = headOfFace(
            TLBox(x0: 0.4, y0: 0.3, x1: 0.5, y1: 0.45), yaw: Double.pi / 2, roll: 0, frameAspect: 1)
        #expect(abs(profile.cx - (0.45 - 0.06)) < 1e-9)
        #expect(abs(profile.width - 0.205) < 1e-9)
        let other = headOfFace(
            TLBox(x0: 0.4, y0: 0.3, x1: 0.5, y1: 0.45), yaw: -Double.pi / 2, roll: 0, frameAspect: 1)
        #expect(other.cx > 0.45)
    }

    @Test func aRolledFaceTiltsItsHead() {
        let face = TLBox(x0: 0.4, y0: 0.3, x1: 0.5, y1: 0.45)
        let upright = headOfFace(face, yaw: 0, roll: 0.1, frameAspect: 1)
        let tilted = headOfFace(face, yaw: 0, roll: 0.6, frameAspect: 1)
        #expect(upright == headOfFace(face, yaw: 0, roll: 0, frameAspect: 1))
        #expect(tilted.width > upright.width)
        // The head's top tilts towards the picture's left as the roll grows.
        #expect(tilted.cx < upright.cx)
    }

    @Test func anUpperBodyWithoutAFaceGetsAHeadAtItsTop() {
        // Top-left body: x 0.3–0.5, y 0.2–0.9, in a landscape frame.
        let upper = DetectedRegion(box: NormBox(x: 0.3, y: 0.1, width: 0.2, height: 0.7), confidence: 0.9)
        let found = findHeads(faces: [], uppers: [upper], humans: [], mask: nil, frameAspect: 16 / 9)
        #expect(found.heads.count == 1)
        let head = TLBox(lowerLeft: found.heads[0].box)
        #expect(abs(head.y0 - 0.2) < 1e-9)
        #expect(abs(head.height - 0.21) < 1e-9)
        #expect(abs(head.cx - 0.4) < 1e-9)
        #expect(found.people.count == 1)
        // With a face on it, the face's head is the only one.
        let faced = findHeads(
            faces: [face(0.37, 0.65, 0.06, 0.1)], uppers: [upper], humans: [], mask: nil, frameAspect: 16 / 9)
        #expect(faced.heads.count == 1)
        #expect(faced.heads[0].confidence == 0.9)
    }

    @Test func eachBodyReachesOverItsHead() {
        let human = DetectedRegion(box: NormBox(x: 0.3, y: 0.0, width: 0.3, height: 0.75), confidence: 0.8)
        // The face's head pokes out of the body's top (y0 0.25 top-left).
        let found = findHeads(
            faces: [face(0.4, 0.62, 0.1, 0.1)], uppers: [], humans: [human], mask: nil, frameAspect: 1)
        let body = TLBox(lowerLeft: found.people[0].box)
        let head = TLBox(lowerLeft: found.heads[0].box)
        #expect(body.y0 <= head.y0 + 1e-9 && head.y0 < 0.25)
    }

    @Test func aPoseSeenFromBehindGetsAHeadOnItsEars() {
        // Top-left: ears at y 0.3, the neck 0.1 below, shoulders 0.2 apart; no face.
        let joint = { (x: Double, y: Double) in PoseJoint(x: x, y: y, confidence: 0.8) }
        let pose = PoseJoints(
            ears: [joint(0.45, 0.3), joint(0.55, 0.3)], face: [], neck: joint(0.5, 0.4),
            leftShoulder: joint(0.4, 0.45), rightShoulder: joint(0.6, 0.45))
        let found = findHeads(faces: [], uppers: [], humans: [], poses: [pose], mask: nil, frameAspect: 1)
        #expect(found.heads.count == 1)
        let head = TLBox(lowerLeft: found.heads[0].box)
        // The shoulders size it (0.2 / 1.25 = 0.16 beats 1.4 × 0.1), grown by 1.2.
        #expect(abs(head.height - 0.192) < 1e-9)
        #expect(abs(head.width - 0.1728) < 1e-9)
        #expect(abs(head.cx - 0.5) < 1e-9)
        #expect(abs(head.y0 - (0.3 - 0.55 * 0.192)) < 1e-9)
        // A face's head in the same place is kept, and the pose adds none.
        let faced = findHeads(
            faces: [face(0.46, 0.62, 0.08, 0.1)], uppers: [], humans: [], poses: [pose], mask: nil, frameAspect: 1)
        #expect(faced.heads.count == 1)
        #expect(faced.heads[0].confidence == 0.9)
        // Without a head joint there is nothing to place.
        #expect(headOfPose(PoseJoints(neck: joint(0.5, 0.4)), frameAspect: 1) == nil)
    }
}
