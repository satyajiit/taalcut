// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreML
import CoreVideo
import Foundation
import Vision

struct DetectionBatch: Sendable {
    var faces: [DetectedFace] = []
    var humans: [DetectedRegion] = []
    /// FRM1: upper bodies, for the heads of people whose face Vision doesn't see.
    var uppers: [DetectedRegion] = []
    var saliency: [DetectedRegion] = []
    /// FRM1: whole heads, whole people and the coarse silhouette (Heads.swift, PersonMask.swift).
    var heads: [DetectedRegion] = []
    var people: [DetectedRegion] = []
    var silhouette: SilhouetteGrid?
}

func detectSubjects(
    _ buffer: CVPixelBuffer, report: inout ComputeReport, logged: inout Set<String>, log: LineLog
) async throws -> DetectionBatch {
    var batch: DetectionBatch
    if #available(macOS 15, *) {
        batch = try await detectModern(buffer, report: &report, logged: &logged, log: log)
    } else {
        batch = try detectLegacy(buffer, report: &report, logged: &logged, log: log)
    }
    // People's pixels: their heads seen from any side, and where they stand.
    let mask = try personMask(buffer, report: &report, logged: &logged, log: log)
    // Ears, neck and shoulders: heads seen from behind, also where no person rectangle was found.
    let poses = try bodyPoses(buffer, logged: &logged, log: log)
    let aspect = Double(CVPixelBufferGetWidth(buffer)) / Double(max(1, CVPixelBufferGetHeight(buffer)))
    let found = findHeads(
        faces: batch.faces, uppers: batch.uppers, humans: batch.humans, poses: poses, mask: mask,
        frameAspect: aspect)
    batch.heads = found.heads
    batch.people = found.people
    batch.silhouette = mask.map { silhouetteGrid($0) }
    return batch
}

@available(macOS 15, *)
private func detectModern(
    _ buffer: CVPixelBuffer, report: inout ComputeReport, logged: inout Set<String>, log: LineLog
) async throws -> DetectionBatch {
    var faces = DetectFaceRectanglesRequest(.revision3)
    var humans = DetectHumanRectanglesRequest(.revision2)
    humans.upperBodyOnly = false
    report.faces = assign(&faces, which: "faces", logged: &logged, log: log)
    report.humans = assign(&humans, which: "humans", logged: &logged, log: log)
    let handler = ImageRequestHandler(buffer)
    var uppers = DetectHumanRectanglesRequest(.revision2)
    uppers.upperBodyOnly = true
    _ = assign(&uppers, which: "uppers", logged: &logged, log: log)
    let faceObservations = try await handler.perform(faces)
    let humanObservations = try await handler.perform(humans)
    let upperObservations = try await handler.perform(uppers)
    var batch = DetectionBatch(
        faces: faceObservations.map(faceRecord),
        humans: humanObservations.map { region($0.boundingBox, confidence: $0.confidence) },
        uppers: upperObservations.map { region($0.boundingBox, confidence: $0.confidence) })
    if batch.faces.isEmpty && batch.humans.isEmpty {
        var saliency = GenerateAttentionBasedSaliencyImageRequest(.revision2)
        report.saliency = assign(&saliency, which: "saliency", logged: &logged, log: log)
        let observation = try await handler.perform(saliency)
        batch.saliency = observation.salientObjects.map { region($0.boundingBox, confidence: $0.confidence) }
    }
    return batch
}

private func detectLegacy(
    _ buffer: CVPixelBuffer, report: inout ComputeReport, logged: inout Set<String>, log: LineLog
) throws -> DetectionBatch {
    let faces = VNDetectFaceRectanglesRequest()
    faces.revision = VNDetectFaceRectanglesRequestRevision3
    let humans = VNDetectHumanRectanglesRequest()
    humans.revision = VNDetectHumanRectanglesRequestRevision2
    humans.upperBodyOnly = false
    report.faces = assignLegacy(faces, which: "faces", logged: &logged, log: log)
    report.humans = assignLegacy(humans, which: "humans", logged: &logged, log: log)
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, options: [:])
    let uppers = VNDetectHumanRectanglesRequest()
    uppers.revision = VNDetectHumanRectanglesRequestRevision2
    uppers.upperBodyOnly = true
    _ = assignLegacy(uppers, which: "uppers", logged: &logged, log: log)
    try handler.perform([faces, humans])
    // A second request of the same kind runs on its own (Vision merges same-kind requests in one perform).
    try handler.perform([uppers])
    var batch = DetectionBatch(
        faces: (faces.results ?? []).map(faceRecordVN),
        humans: (humans.results ?? []).map { region(normBox($0.boundingBox), confidence: Double($0.confidence)) },
        uppers: (uppers.results ?? []).map { region(normBox($0.boundingBox), confidence: Double($0.confidence)) })
    if batch.faces.isEmpty && batch.humans.isEmpty {
        let saliency = VNGenerateAttentionBasedSaliencyImageRequest()
        saliency.revision = 2
        report.saliency = assignLegacy(saliency, which: "saliency", logged: &logged, log: log)
        try handler.perform([saliency])
        let objects = (saliency.results?.first as? VNSaliencyImageObservation)?.salientObjects ?? []
        batch.saliency = objects.map { region(normBox($0.boundingBox), confidence: Double($0.confidence)) }
    }
    return batch
}

@available(macOS 15, *)
private func assign<R: VisionRequest>(
    _ request: inout R, which: String, logged: inout Set<String>, log: LineLog
) -> ComputeKind {
    let devices = request.supportedComputeStageDevices[.main] ?? []
    let kinds = devices.map(computeKind)
    let chosen = chooseCompute(available: kinds)
    if chosen == .neuralEngine, let device = devices.first(where: { computeKind($0) == .neuralEngine }) {
        request.setComputeDevice(device, for: .main)
    }
    if chosen == .cpu {
        noteCPUFallback(which: which, reason: "only the CPU is listed for the main stage", logged: &logged, log: log)
    }
    return chosen
}

private func assignLegacy(
    _ request: VNRequest, which: String, logged: inout Set<String>, log: LineLog
) -> ComputeKind {
    let devices = (try? request.supportedComputeStageDevices[.main]) ?? []
    let kinds = devices.map(computeKind)
    let chosen = chooseCompute(available: kinds)
    if chosen == .neuralEngine, let device = devices.first(where: { computeKind($0) == .neuralEngine }) {
        request.setComputeDevice(device, for: .main)
    }
    if chosen == .cpu {
        noteCPUFallback(which: which, reason: "only the CPU is listed for the main stage", logged: &logged, log: log)
    }
    return chosen
}

@available(macOS 15, *)
private func faceRecord(_ observation: FaceObservation) -> DetectedFace {
    DetectedFace(
        box: normBox(observation.boundingBox),
        confidence: Double(observation.confidence),
        roll: observation.roll.converted(to: .radians).value,
        yaw: observation.yaw.converted(to: .radians).value,
        pitch: observation.pitch.converted(to: .radians).value)
}

private func faceRecordVN(_ observation: VNFaceObservation) -> DetectedFace {
    DetectedFace(
        box: normBox(observation.boundingBox),
        confidence: Double(observation.confidence),
        roll: observation.roll?.doubleValue ?? 0,
        yaw: observation.yaw?.doubleValue ?? 0,
        pitch: observation.pitch?.doubleValue ?? 0)
}

@available(macOS 15, *)
private func region(_ box: NormalizedRect, confidence: Float) -> DetectedRegion {
    DetectedRegion(box: normBox(box), confidence: Double(confidence))
}

private func region(_ box: NormBox, confidence: Double) -> DetectedRegion {
    DetectedRegion(box: box, confidence: confidence)
}

@available(macOS 15, *)
private func normBox(_ box: NormalizedRect) -> NormBox {
    NormBox(x: Double(box.cgRect.origin.x), y: Double(box.cgRect.origin.y), width: Double(box.width), height: Double(box.height))
}

private func normBox(_ box: CGRect) -> NormBox {
    NormBox(x: Double(box.origin.x), y: Double(box.origin.y), width: Double(box.width), height: Double(box.height))
}

private func computeKind(_ device: MLComputeDevice) -> ComputeKind {
    switch device {
    case .cpu: return .cpu
    case .neuralEngine: return .neuralEngine
    case .gpu: return .gpu
    @unknown default: return .gpu
    }
}
