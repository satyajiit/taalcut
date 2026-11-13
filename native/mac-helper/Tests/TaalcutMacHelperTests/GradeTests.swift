// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import Testing

@testable import TaalcutMacHelper

@Suite struct GradeTests {
    @Test func identityCubeIsRedFastest() {
        guard case .success(let lut) = parseCube(identityCube()) else {
            Issue.record("identity cube did not parse")
            return
        }
        #expect(lut.count == 17 * 17 * 17)
        #expect(lut.samples.prefix(4) == [0, 0, 0, 1])
        #expect(Array(lut.samples.suffix(4)) == [1, 1, 1, 1])
        let red = 3
        let green = 2
        let blue = 1
        let offset = (red + 17 * green + 17 * 17 * blue) * 4
        #expect(abs(lut.samples[offset] - Float(red) / 16) < 0.0001)
        #expect(abs(lut.samples[offset + 1] - Float(green) / 16) < 0.0001)
        #expect(abs(lut.samples[offset + 2] - Float(blue) / 16) < 0.0001)
        #expect(lut.samples[offset + 3] == 1)
        #expect(cubeData(lut).count == lut.samples.count * MemoryLayout<Float>.size)
    }

    @Test func parserRejectsABadCube() {
        #expect(parseCube("LUT_3D_SIZE 17\r\n") == .failure(.invalid))
        #expect(parseCube("LUT_1D_SIZE 17\n") == .failure(.invalid))
        #expect(parseCube("LUT_3D_SIZE 2\n") == .failure(.invalid))
        #expect(parseCube("LUT_3D_SIZE 17\n1.5 0 0\n") == .failure(.invalid))
        #expect(parseCube("LUT_3D_SIZE 17\nDOMAIN_MIN 1 0 0\n") == .failure(.invalid))
        #expect(parseCube("LUT_3D_SIZE 17\nDOMAIN_MAX 1 1 2\n") == .failure(.invalid))
        #expect(parseCube("LUT_3D_SIZE 17\nFOO 1\n") == .failure(.invalid))
        #expect(parseCube("LUT_3D_SIZE 17\n0.1 0.2\n") == .failure(.invalid))
        #expect(parseCube("LUT_3D_SIZE 17\n0 0 0\n") == .failure(.invalid))
    }

    @Test func colourSpaceIsCheckedBeforeAnyFile() async {
        let response = await applyVideoCube(
            params: .object(["colourSpace": .string("pq")]),
            progress: { _ in },
            confinement: PathConfinement(roots: ["/tmp"]))
        #expect(response.failure?.code == "helper.bad_request")
    }

    @Test func missingAndInvalidCubesFailBeforeDecode() async throws {
        let root = try GradeScratch()
        let input = root.url.appendingPathComponent("in.mov")
        let output = root.url.appendingPathComponent("out.mov")
        let missing = await applyVideoCube(
            params: gradeParams(input: input, output: output, cube: root.url.appendingPathComponent("missing.cube")),
            progress: { _ in },
            confinement: PathConfinement(roots: [root.url.path]))
        #expect(missing.failure?.code == "grade.unreadable")
        let cube = root.url.appendingPathComponent("bad.cube")
        try Data("LUT_3D_SIZE 2\n".utf8).write(to: cube)
        let invalid = await applyVideoCube(
            params: gradeParams(input: input, output: output, cube: cube),
            progress: { _ in },
            confinement: PathConfinement(roots: [root.url.path]))
        #expect(invalid.failure?.code == "grade.cube_invalid")
        #expect(invalid.failure?.retryable == false)
        #expect(FileManager.default.fileExists(atPath: input.path) == false)
    }

    @Test func identityCubeGradesAShortClipOnTheGPU() async throws {
        let root = try GradeScratch()
        let input = root.url.appendingPathComponent("in.mov")
        let output = root.url.appendingPathComponent("out.mov")
        let cube = root.url.appendingPathComponent("identity.cube")
        try await writeSolidClip(to: input, frames: 2, width: 64, height: 64)
        try Data(identityCube().utf8).write(to: cube)
        let response = await applyVideoCube(
            params: gradeParams(input: input, output: output, cube: cube),
            progress: { _ in },
            confinement: PathConfinement(roots: [root.url.path]))
        if response.failure?.code == "grade.no_metal" {
            return
        }
        #expect(response.failure == nil)
        #expect(response.result?.key("compute")?.string == "gpu")
        #expect(response.result?.key("width")?.number == 64)
        #expect(response.result?.key("height")?.number == 64)
        let frames = try #require(response.result?.key("frames")?.number)
        #expect(frames >= 1)
        #expect(FileManager.default.fileExists(atPath: output.path))
    }
}

private func identityCube() -> String {
    var lines = ["TITLE \"identity\"", "LUT_3D_SIZE 17", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]
    for blue in 0..<17 {
        for green in 0..<17 {
            for red in 0..<17 {
                lines.append("\(Float(red) / 16) \(Float(green) / 16) \(Float(blue) / 16)")
            }
        }
    }
    return lines.joined(separator: "\n") + "\n"
}

private func gradeParams(input: URL, output: URL, cube: URL) -> JSONValue {
    .object([
        "input": .string(input.path),
        "output": .string(output.path),
        "cube": .string(cube.path),
        "colourSpace": .string("bt709"),
    ])
}

private struct GradeScratch {
    let url: URL
    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-grade-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}

private enum ClipWriteError: Error { case failed }

private func writeSolidClip(to url: URL, frames: Int, width: Int, height: Int) async throws {
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
    for index in 0..<frames {
        guard await waitUntilReady(input), let pool = adaptor.pixelBufferPool else { throw ClipWriteError.failed }
        var buffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else {
            throw ClipWriteError.failed
        }
        fillGray(buffer, value: 40)
        let time = CMTime(value: CMTimeValue(index), timescale: 30)
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
