// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreML
import CoreVideo
import Foundation
import Vision

/// One object tracker for a shot. Used on the decode task only; it is not sent elsewhere.
final class SubjectFollower {
    fileprivate var modern: AnyObject?
    fileprivate var legacy: VNTrackObjectRequest?
    fileprivate let legacyHandler = VNSequenceRequestHandler()
    var compute: ComputeKind = .gpu
}

func seedFollower(_ follower: SubjectFollower, box: NormBox, logged: inout Set<String>, log: LineLog) {
    if #available(macOS 15, *) {
        seedModern(follower, box: box, logged: &logged, log: log)
    } else {
        seedLegacy(follower, box: box, logged: &logged, log: log)
    }
}

func stepFollower(
    _ follower: SubjectFollower, buffer: CVPixelBuffer, isLast: Bool, logged: inout Set<String>, log: LineLog
) async throws -> (box: NormBox, confidence: Double)? {
    if #available(macOS 15, *) {
        return try await stepModern(follower, buffer: buffer, logged: &logged, log: log)
    }
    return try stepLegacy(follower, buffer: buffer, isLast: isLast, logged: &logged, log: log)
}

@available(macOS 15, *)
private func seedModern(_ follower: SubjectFollower, box: NormBox, logged: inout Set<String>, log: LineLog) {
    let rect = NormalizedRect(
        x: CGFloat(box.x), y: CGFloat(box.y), width: CGFloat(box.width), height: CGFloat(box.height))
    let seed = DetectedObjectObservation(boundingBox: rect)
    let request = TrackObjectRequest(detectedObject: seed, .revision2)
    follower.compute = assignTrack(request, logged: &logged, log: log)
    follower.modern = request
    follower.legacy = nil
}

@available(macOS 15, *)
private func stepModern(
    _ follower: SubjectFollower, buffer: CVPixelBuffer, logged: inout Set<String>, log: LineLog
) async throws -> (box: NormBox, confidence: Double)? {
    guard let request = follower.modern as? TrackObjectRequest else { return nil }
    if follower.compute == .gpu || follower.compute == .cpu {
        follower.compute = assignTrack(request, logged: &logged, log: log)
    }
    let observation = try await ImageRequestHandler(buffer).perform(request)
    guard let observation else { return nil }
    let box = observation.boundingBox
    return (
        NormBox(x: Double(box.cgRect.origin.x), y: Double(box.cgRect.origin.y), width: Double(box.width), height: Double(box.height)),
        Double(observation.confidence))
}

private func seedLegacy(_ follower: SubjectFollower, box: NormBox, logged: inout Set<String>, log: LineLog) {
    let seed = VNDetectedObjectObservation(boundingBox: CGRect(x: box.x, y: box.y, width: box.width, height: box.height))
    let request = VNTrackObjectRequest(detectedObjectObservation: seed)
    request.revision = VNTrackObjectRequestRevision2
    follower.compute = assignLegacyTrack(request, logged: &logged, log: log)
    follower.legacy = request
    follower.modern = nil
}

private func stepLegacy(
    _ follower: SubjectFollower, buffer: CVPixelBuffer, isLast: Bool, logged: inout Set<String>, log: LineLog
) throws -> (box: NormBox, confidence: Double)? {
    guard let request = follower.legacy else { return nil }
    request.isLastFrame = isLast
    if follower.compute == .gpu || follower.compute == .cpu {
        follower.compute = assignLegacyTrack(request, logged: &logged, log: log)
    }
    try follower.legacyHandler.perform([request], on: buffer)
    guard let observation = request.results?.first as? VNDetectedObjectObservation else { return nil }
    let box = observation.boundingBox
    return (NormBox(x: box.origin.x, y: box.origin.y, width: box.width, height: box.height), Double(observation.confidence))
}

@available(macOS 15, *)
private func assignTrack(_ request: TrackObjectRequest, logged: inout Set<String>, log: LineLog) -> ComputeKind {
    let devices = mainStageDevices(request)
    let chosen = chooseCompute(available: devices.map(trackComputeKind))
    if chosen == .neuralEngine, let device = devices.first(where: { trackComputeKind($0) == .neuralEngine }) {
        request.setComputeDevice(device, for: .main)
    }
    if chosen == .cpu {
        noteCPUFallback(which: "track", reason: "only the CPU is listed for the main stage", logged: &logged, log: log)
    }
    return chosen
}

private func assignLegacyTrack(_ request: VNTrackObjectRequest, logged: inout Set<String>, log: LineLog) -> ComputeKind {
    let devices = (try? request.supportedComputeStageDevices[.main]) ?? []
    let chosen = chooseCompute(available: devices.map(trackComputeKind))
    if chosen == .neuralEngine, let device = devices.first(where: { trackComputeKind($0) == .neuralEngine }) {
        request.setComputeDevice(device, for: .main)
    }
    if chosen == .cpu {
        noteCPUFallback(which: "track", reason: "only the CPU is listed for the main stage", logged: &logged, log: log)
    }
    return chosen
}

@available(macOS 15, *)
private func mainStageDevices<R: VisionRequest>(_ request: R) -> [MLComputeDevice] {
    request.supportedComputeStageDevices[.main] ?? []
}

private func trackComputeKind(_ device: MLComputeDevice) -> ComputeKind {
    switch device {
    case .cpu: return .cpu
    case .neuralEngine: return .neuralEngine
    case .gpu: return .gpu
    @unknown default: return .gpu
    }
}
