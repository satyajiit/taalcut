// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreVideo
import Foundation
import Vision

/// FRM1: Vision's 2D body pose (`VNDetectHumanBodyPoseRequest`, every person it finds): the ears, eyes, nose, neck and
/// shoulders that place a head when no face does (Heads.swift `headOfPose`). Joints only; never sent anywhere.
func bodyPoses(
    _ buffer: CVPixelBuffer, logged: inout Set<String>, log: LineLog
) throws -> [PoseJoints] {
    let request = VNDetectHumanBodyPoseRequest()
    // Its device isn't reported: the track's compute parts are core's, and a CPU-only pose is logged here.
    _ = assignVisionCompute(request, which: "pose", logged: &logged, log: log)
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, options: [:])
    try handler.perform([request])
    return (request.results ?? []).map(poseJoints)
}

private func poseJoints(_ observation: VNHumanBodyPoseObservation) -> PoseJoints {
    let points = (try? observation.recognizedPoints(.all)) ?? [:]
    // Vision's points are lower-left; heads are worked out top-left.
    let joint = { (name: VNHumanBodyPoseObservation.JointName) -> PoseJoint? in
        guard let point = points[name], point.confidence > 0 else { return nil }
        return PoseJoint(x: Double(point.location.x), y: 1 - Double(point.location.y), confidence: Double(point.confidence))
    }
    return PoseJoints(
        ears: [joint(.leftEar), joint(.rightEar)].compactMap { $0 },
        face: [joint(.leftEye), joint(.rightEye), joint(.nose)].compactMap { $0 },
        neck: joint(.neck), leftShoulder: joint(.leftShoulder), rightShoulder: joint(.rightShoulder))
}
