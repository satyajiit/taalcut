// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import Testing

@testable import TaalcutMacHelper

@Suite struct TrackTests {
    @Test func pairsAFaceInsideAHuman() {
        let face = DetectedFace(
            box: NormBox(x: 0.41, y: 0.62, width: 0.12, height: 0.08),
            confidence: 0.98, roll: 0.1, yaw: -0.2, pitch: 0.05)
        let human = DetectedRegion(box: NormBox(x: 0.3, y: 0.1, width: 0.38, height: 0.8), confidence: 0.93)
        let choice = chooseSubject(faces: [face], humans: [human], saliency: [], previous: nil)
        #expect(choice.kind == .union)
        #expect(choice.confidence == 0.93)
        #expect(choice.box == human.box)
        #expect(abs(choice.focus.x - 0.47) < 0.0001)
        #expect(abs(choice.focus.y - 0.66) < 0.0001)
        let anchor = FocusAnchor.from(box: choice.box, focus: choice.focus)
        let moved = NormBox(x: 0.1, y: 0.2, width: 0.5, height: 0.4)
        let point = anchor.point(in: moved)
        #expect(abs(point.x - (moved.x + anchor.fx * moved.width)) < 0.0001)
        #expect(abs(point.y - (moved.y + anchor.fy * moved.height)) < 0.0001)
    }

    @Test func unionExtendsPastTheHumanWhenTheFaceDoes() {
        let face = DetectedFace(
            box: NormBox(x: 0.2, y: 0.62, width: 0.2, height: 0.08),
            confidence: 0.9, roll: 0, yaw: 0, pitch: 0)
        let human = DetectedRegion(box: NormBox(x: 0.3, y: 0.1, width: 0.38, height: 0.8), confidence: 0.8)
        let choice = chooseSubject(faces: [face], humans: [human], saliency: [], previous: nil)
        #expect(choice.kind == .union)
        #expect(choice.box.x == 0.2)
        #expect(choice.box.width > human.box.width)
    }

    @Test func severalPeoplePreferThePreviousBox() {
        let left = DetectedRegion(box: NormBox(x: 0, y: 0, width: 0.4, height: 0.8), confidence: 0.4)
        let right = DetectedRegion(box: NormBox(x: 0.6, y: 0, width: 0.4, height: 0.8), confidence: 0.99)
        let previous = NormBox(x: 0.05, y: 0.05, width: 0.3, height: 0.6)
        let followed = chooseSubject(faces: [], humans: [left, right], saliency: [], previous: previous)
        #expect(followed.box == left.box)
        let brightest = chooseSubject(faces: [], humans: [left, right], saliency: [], previous: nil)
        #expect(brightest.box == right.box)
    }

    @Test func saliencyAndEmptyAndLoneFace() {
        let face = DetectedFace(
            box: NormBox(x: 0.1, y: 0.1, width: 0.2, height: 0.2),
            confidence: 0.7, roll: 0, yaw: 0, pitch: 0)
        #expect(chooseSubject(faces: [face], humans: [], saliency: [], previous: nil).kind == .face)
        let spot = DetectedRegion(box: NormBox(x: 0.4, y: 0.4, width: 0.1, height: 0.1), confidence: 0.5)
        #expect(chooseSubject(faces: [], humans: [], saliency: [spot], previous: nil).kind == .saliency)
        #expect(chooseSubject(faces: [], humans: [], saliency: [], previous: nil).kind == .none)
    }

    @Test func trackStepThresholds() {
        #expect(trackStep(confidence: 0.29, iou: 1, hasDetection: true) == .drop)
        #expect(trackStep(confidence: 0.3, iou: 0, hasDetection: false) == .keep)
        #expect(trackStep(confidence: 0.9, iou: 0.5, hasDetection: true) == .keep)
        #expect(trackStep(confidence: 0.9, iou: 0.49, hasDetection: true) == .reseed)
    }

    @Test func rolesLandOnDetectAndTrackTicks() {
        let mixed = sampleRoles(start: 0, end: 1, detectHz: 4, trackHz: 12, stamps: [0, 0.05, 0.09, 0.25])
        #expect(mixed == [.detect, nil, .track, .detect])
        let detectOnly = sampleRoles(start: 0, end: 0.5, detectHz: 8, trackHz: 0, stamps: [0, 0.125, 0.25, 0.375, 0.5])
        #expect(detectOnly == [.detect, .detect, .detect, .detect, nil])
    }

    @Test func documentKeepsEmptyObservationArrays() {
        let sample = TrackSample(
            time: CMTime(value: 0, timescale: 30), source: .detect,
            faces: [], humans: [], saliency: [], subject: .none)
        let document = TrackDocument(
            width: 64, height: 66, compute: ComputeReport(), samples: [sample],
            decodeMs: 1, detectMs: 2, trackMs: 3)
        let json = document.json
        #expect(json.key("api")?.string == "Vision")
        #expect(json.key("boxSpace")?.string == "normalized-lower-left")
        for key in ["faces", "humans", "saliency", "track"] {
            #expect(json.key("compute")?.key(key)?.string == "gpu")
        }
        let first = json.key("samples")?.array?.first
        #expect(first?.key("faces")?.array?.isEmpty == true)
        #expect(first?.key("humans")?.array?.isEmpty == true)
        #expect(first?.key("saliency")?.array?.isEmpty == true)
        #expect(first?.key("subject")?.key("kind")?.string == "none")
    }

    @Test func computePrefersTheEngineThenTheGPU() {
        #expect(chooseCompute(available: [.gpu, .neuralEngine]) == .neuralEngine)
        #expect(chooseCompute(available: [.cpu, .cpu]) == .cpu)
        #expect(chooseCompute(available: []) == .gpu)
        #expect(chooseCompute(available: [.cpu, .gpu]) == .gpu)
        let box = LogBox()
        var logged = Set<String>()
        let log = LineLog { box.append($0) }
        noteCPUFallback(which: "faces", reason: "no engine", logged: &logged, log: log)
        noteCPUFallback(which: "faces", reason: "again", logged: &logged, log: log)
        #expect(box.lines.count == 1)
        #expect(box.lines[0] == "[track] CPU fallback faces: no engine")
    }

    @Test func rejectsALongRangeAndABadRateBeforeOpeningTheFile() async {
        let confinement = PathConfinement(roots: ["/tmp"])
        let long = await trackShot(
            params: shotParams(path: "/tmp/missing.mov", endValue: 601, rate: 1, detectHz: nil, trackHz: nil, shortSide: nil),
            progress: { _ in }, confinement: confinement)
        #expect(long.failure?.code == "track.too_long")
        #expect(long.failure?.retryable == false)
        let hertz = await trackShot(
            params: shotParams(path: "/tmp/missing.mov", endValue: 1, rate: 1, detectHz: 9, trackHz: nil, shortSide: nil),
            progress: { _ in }, confinement: confinement)
        #expect(hertz.failure?.code == "helper.bad_request")
        let trackRate = await trackShot(
            params: shotParams(path: "/tmp/missing.mov", endValue: 1, rate: 1, detectHz: 4, trackHz: 3, shortSide: nil),
            progress: { _ in }, confinement: confinement)
        #expect(trackRate.failure?.code == "helper.bad_request")
    }

    @Test func missingMediaIsUnreadable() async throws {
        let root = try TrackScratch()
        let response = await trackShot(
            params: shotParams(
                path: root.url.appendingPathComponent("missing.mov").path,
                endValue: 1, rate: 1, detectHz: nil, trackHz: nil, shortSide: nil),
            progress: { _ in }, confinement: PathConfinement(roots: [root.url.path]))
        #expect(response.failure?.code == "track.unreadable")
    }

    @Test func shotDocumentShapeFromAPortraitClip() async throws {
        let root = try TrackScratch()
        let movie = root.url.appendingPathComponent("portrait.mov")
        try await writePortraitClip(to: movie)
        let response = await trackShot(
            params: shotParams(path: movie.path, endValue: 1, rate: 2, detectHz: 8, trackHz: 0, shortSide: 64),
            progress: { _ in }, confinement: PathConfinement(roots: [root.url.path]))
        try assertShotShape(response)
    }

    @Test func aFlatFrameIsNoneOrSaliency() async throws {
        let root = try TrackScratch()
        let movie = root.url.appendingPathComponent("gray.mov")
        try await writeSolidClip(to: movie, width: 96, height: 128, gray: 30)
        let response = await trackShot(
            params: shotParams(path: movie.path, endValue: 1, rate: 2, detectHz: 8, trackHz: 0, shortSide: 64),
            progress: { _ in }, confinement: PathConfinement(roots: [root.url.path]))
        try assertShotShape(response)
        let samples = try #require(response.result?.key("samples")?.array)
        for sample in samples {
            let kind = sample.key("subject")?.key("kind")?.string
            #expect(kind == "none" || kind == "saliency")
        }
    }
}

private func shotParams(
    path: String, endValue: Double, rate: Double, detectHz: Double?, trackHz: Double?, shortSide: Double?
) -> JSONValue {
    var body: [String: JSONValue] = [
        "path": .string(path),
        "start": .object(["value": .number(0), "rate": .number(rate)]),
        "end": .object(["value": .number(endValue), "rate": .number(rate)]),
    ]
    if let detectHz { body["detectHz"] = .number(detectHz) }
    if let trackHz { body["trackHz"] = .number(trackHz) }
    if let shortSide { body["shortSide"] = .number(shortSide) }
    return .object(body)
}

private func assertShotShape(_ response: WorkResponse) throws {
    #expect(response.failure == nil)
    let result = try #require(response.result)
    #expect(result.key("api")?.string == "Vision")
    #expect(result.key("boxSpace")?.string == "normalized-lower-left")
    let width = try #require(result.key("width")?.number)
    let height = try #require(result.key("height")?.number)
    #expect(Int(width) % 2 == 0)
    #expect(Int(height) % 2 == 0)
    for key in ["faces", "humans", "saliency", "track"] {
        #expect(result.key("compute")?.key(key) != nil)
    }
    let samples = try #require(result.key("samples")?.array)
    #expect(!samples.isEmpty)
    for sample in samples {
        #expect(sample.key("faces")?.array != nil)
        #expect(sample.key("humans")?.array != nil)
        #expect(sample.key("saliency")?.array != nil)
    }
}

private final class LogBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String] = []
    var lines: [String] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
    func append(_ line: String) {
        lock.lock()
        stored.append(line)
        lock.unlock()
    }
}

private struct TrackScratch {
    let url: URL
    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-track-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}

private enum ClipWriteError: Error { case failed }

private func writePortraitClip(to url: URL) async throws {
    let fixture = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("Fixtures/portrait-pd.jpg")
    guard let source = CGImageSourceCreateWithURL(fixture as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { throw ClipWriteError.failed }
    try await writeClip(to: url, width: 96, height: 128) { buffer in
        draw(image, into: buffer)
    }
}

private func writeSolidClip(to url: URL, width: Int, height: Int, gray: UInt8) async throws {
    try await writeClip(to: url, width: width, height: height) { buffer in
        fillGray(buffer, value: gray)
    }
}

private func writeClip(
    to url: URL, width: Int, height: Int, paint: (CVPixelBuffer) -> Void
) async throws {
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
    ])
    input.expectsMediaDataInRealTime = true
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
    ])
    guard writer.canAdd(input) else { throw ClipWriteError.failed }
    writer.add(input)
    guard writer.startWriting() else { throw ClipWriteError.failed }
    writer.startSession(atSourceTime: .zero)
    for index in 0..<4 {
        guard await waitUntilReady(input), let pool = adaptor.pixelBufferPool else { throw ClipWriteError.failed }
        var buffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else {
            throw ClipWriteError.failed
        }
        paint(buffer)
        let time = CMTime(value: CMTimeValue(index), timescale: 8)
        guard adaptor.append(buffer, withPresentationTime: time) else { throw ClipWriteError.failed }
    }
    input.markAsFinished()
    await writer.finishWriting()
    guard writer.status == .completed else { throw ClipWriteError.failed }
}

private func waitUntilReady(_ input: AVAssetWriterInput) async -> Bool {
    for _ in 0..<2000 {
        if input.isReadyForMoreMediaData { return true }
        try? await Task.sleep(for: .milliseconds(2))
    }
    return false
}

private func fillGray(_ buffer: CVPixelBuffer, value: UInt8) {
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return }
    let height = CVPixelBufferGetHeight(buffer)
    let bytes = CVPixelBufferGetBytesPerRow(buffer)
    memset(base, Int32(value), height * bytes)
}

private func draw(_ image: CGImage, into buffer: CVPixelBuffer) {
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    guard let base = CVPixelBufferGetBaseAddress(buffer),
        let context = CGContext(
            data: base, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
}
