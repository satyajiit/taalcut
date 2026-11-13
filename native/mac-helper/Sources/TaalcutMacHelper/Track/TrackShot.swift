// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreMedia
import CoreVideo
import Foundation

private struct ShotRequest {
    var path: String
    var start: CMTime
    var end: CMTime
    var startSeconds: Double
    var endSeconds: Double
    var detectHz: Double
    var trackHz: Double
    var shortSide: Int
}

private final class CursorBox {
    var cursor: RoleCursor
    init(_ cursor: RoleCursor) { self.cursor = cursor }
}

private final class ShotTrace {
    var report = ComputeReport()
    var logged = Set<String>()
    let follower = SubjectFollower()
    var seeded = false
    var previous: NormBox?
    var anchor = FocusAnchor(fx: 0.5, fy: 0.5)
    var samples: [TrackSample] = []
    var detectMs = 0
    var trackMs = 0
    let log = LineLog.standard

    func absorb(_ buffer: CVPixelBuffer, time: CMTime, role: SampleRole, isLast: Bool) async throws {
        let clock = ContinuousClock()
        let started = clock.now
        if role == .detect {
            let batch = try await detectSubjects(buffer, report: &report, logged: &logged, log: log)
            detectMs += milliseconds(since: started, clock: clock)
            let choice = chooseSubject(
                faces: batch.faces, humans: batch.humans, saliency: batch.saliency, previous: previous)
            let subject = applyDetection(choice)
            samples.append(TrackSample(
                time: time, source: .detect, faces: batch.faces, humans: batch.humans,
                saliency: batch.saliency, subject: subject, heads: batch.heads, people: batch.people,
                silhouette: batch.silhouette))
        } else {
            let subject = try await applyTrack(buffer, isLast: isLast, started: started, clock: clock)
            samples.append(TrackSample(
                time: time, source: .track, faces: [], humans: [], saliency: [], subject: subject))
        }
        report.track = follower.compute
    }

    private func applyDetection(_ choice: SubjectChoice) -> SubjectChoice {
        guard choice.kind != .none else {
            seeded = false
            previous = nil
            return .none
        }
        if let previous {
            let decision = trackStep(confidence: choice.confidence, iou: choice.box.iou(previous), hasDetection: true)
            if decision == .drop {
                seeded = false
                self.previous = nil
                return .none
            }
        }
        seedFollower(follower, box: choice.box, logged: &logged, log: log)
        seeded = true
        anchor = FocusAnchor.from(box: choice.box, focus: choice.focus)
        previous = choice.box
        return choice
    }

    private func applyTrack(
        _ buffer: CVPixelBuffer, isLast: Bool, started: ContinuousClock.Instant, clock: ContinuousClock
    ) async throws -> SubjectChoice {
        guard seeded else { return .none }
        let stepped = try await stepFollower(follower, buffer: buffer, isLast: isLast, logged: &logged, log: log)
        trackMs += milliseconds(since: started, clock: clock)
        guard let stepped else {
            seeded = false
            previous = nil
            return .none
        }
        if trackStep(confidence: stepped.confidence, iou: 0, hasDetection: false) == .drop {
            seeded = false
            previous = nil
            return .none
        }
        previous = stepped.box
        return SubjectChoice(kind: .track, box: stepped.box, focus: anchor.point(in: stepped.box), confidence: stepped.confidence)
    }
}

func trackShot(
    params: JSONValue, progress: @escaping @Sendable (Double) -> Void, confinement: PathConfinement
) async -> WorkResponse {
    switch shotRequest(params) {
    case .failure(let failure):
        return .fail(failure)
    case .success(let request):
        switch confinement.resolve(request.path) {
        case .failure(let failure):
            return .fail(failure)
        case .success(let url):
            guard FileManager.default.fileExists(atPath: url.path) else {
                return .fail(.failed("track.unreadable", "media is unreadable", retryable: false))
            }
            return await runShot(request, url: url, progress: progress)
        }
    }
}

private func runShot(
    _ request: ShotRequest, url: URL, progress: @escaping @Sendable (Double) -> Void
) async -> WorkResponse {
    let clock = ContinuousClock()
    let started = clock.now
    let trace = ShotTrace()
    let cursor = CursorBox(RoleCursor(
        start: request.startSeconds, end: request.endSeconds, detectHz: request.detectHz, trackHz: request.trackHz))
    let span = request.endSeconds - request.startSeconds
    do {
        let size = try await readShot(
            url: url, start: request.start, end: request.end, shortSide: request.shortSide
        ) {
            buffer, time, isLast in
            guard let role = cursor.cursor.role(at: time.seconds) else { return }
            try await trace.absorb(buffer, time: time, role: role, isLast: isLast)
            let fraction = span > 0 ? (time.seconds - request.startSeconds) / span : 1
            progress(min(1, max(0, fraction)))
        }
        let decodeMs = max(0, milliseconds(since: started, clock: clock) - trace.detectMs - trace.trackMs)
        let document = TrackDocument(
            width: size.width, height: size.height, compute: trace.report, samples: trace.samples,
            decodeMs: decodeMs, detectMs: trace.detectMs, trackMs: trace.trackMs)
        return .ok(document.json)
    } catch is CancellationError {
        return .fail(.cancelled)
    } catch let error as ShotReadError {
        switch error {
        case .unreadable:
            return .fail(.failed("track.unreadable", "media is unreadable", retryable: false))
        case .decodeFailed:
            return .fail(.failed("track.decode_failed", "could not decode the shot", retryable: true))
        }
    } catch {
        return .fail(.failed("track.decode_failed", "could not decode the shot", retryable: true))
    }
}

private func shotRequest(_ params: JSONValue) -> Result<ShotRequest, HelperFailure> {
    guard let path = params.key("path")?.string, !path.isEmpty else {
        return .failure(.badRequest("path is required"))
    }
    guard let start = rational(params.key("start")), let end = rational(params.key("end")) else {
        return .failure(.badRequest("start and end must be rational times"))
    }
    let startSeconds = start.seconds
    let endSeconds = end.seconds
    guard startSeconds.isFinite, endSeconds.isFinite, endSeconds > startSeconds else {
        return .failure(.badRequest("end must be after start"))
    }
    if endSeconds - startSeconds > 600 {
        return .failure(.failed("track.too_long", "shot is longer than 600 seconds", retryable: false))
    }
    let detect = whole(params.key("detectHz")) ?? 4
    guard (1...8).contains(detect) else { return .failure(.badRequest("detectHz must be from 1 to 8")) }
    let track = whole(params.key("trackHz")) ?? 12
    guard track == 0 || (detect...30).contains(track) else {
        return .failure(.badRequest("trackHz must be 0 or from detectHz to 30"))
    }
    let side = whole(params.key("shortSide")) ?? 480
    guard (64...1920).contains(side) else { return .failure(.badRequest("shortSide must be from 64 to 1920")) }
    return .success(ShotRequest(
        path: path, start: start, end: end, startSeconds: startSeconds, endSeconds: endSeconds,
        detectHz: Double(detect), trackHz: Double(track), shortSide: side & ~1))
}

/// A JSON number that is a whole number (`track.shot`'s, `decode.pass`'s and the embed requests' params).
/// A JSON number that is a whole `Int`, or nil: `Int(exactly:)` refuses fractions, NaN, infinities and anything out
/// of range (2^63 passed the old `<= Double(Int.max)` check and stopped the process in `Int(_:)`).
func whole(_ value: JSONValue?) -> Int? {
    guard let number = value?.number else { return nil }
    return Int(exactly: number)
}

private func rational(_ value: JSONValue?) -> CMTime? {
    guard let raw = value?.key("value")?.number, let rate = value?.key("rate")?.number,
        raw.isFinite, rate.isFinite, rate > 0, rate.rounded() == rate, raw.rounded() == raw,
        rate <= Double(Int32.max), abs(raw) <= Double(Int64.max)
    else { return nil }
    return CMTime(value: CMTimeValue(raw), timescale: CMTimeScale(rate))
}
