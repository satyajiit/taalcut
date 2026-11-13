// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

/// `decode.pass` end to end on clips the bundled FFmpeg encodes in software at test time. These decode with
/// VideoToolbox: run them under the machine's VideoToolbox lock (`swift test --filter DecodePassTests`). Serialized:
/// one test at a time keeps the decode sessions open at once within the service's own limit.
@Suite(.serialized, .enabled(if: DecodeFixtures.available, "needs the bundled FFmpeg (tools/ffmpeg/dist) to make fixtures"))
struct DecodePassTests {
    private let rate: JSONValue = .object(["num": .number(30), "den": .number(1)])
    /// One 256×144 NV12 frame; and the 144×256 one of a turned clip.
    private let landscape: Int = 256 * 144 * 3 / 2
    private let portrait: Int = 144 * 256 * 3 / 2
    private let smallRGB: Int = 160 * 90 * 3

    private func params(
        _ scratch: DecodeScratch, source: String, analysis: String, width: Int = 256, height: Int = 144,
        window: (Int, Int)? = nil, rotation: Int = 0, sets: [JSONValue] = []
    ) -> JSONValue {
        var object: [String: JSONValue] = [
            "path": .string(source), "rate": rate, "rotation": .number(Double(rotation)),
            "analysis": .object(["width": .number(Double(width)), "height": .number(Double(height)), "path": .string(analysis)]),
            "sets": .array(sets),
        ]
        if let window { object["window"] = .object(["from": .number(Double(window.0)), "frames": .number(Double(window.1))]) }
        return .object(object)
    }

    private func set(_ path: String, width: Int, height: Int, every: Int, maxFrames: Int = 1000) -> JSONValue {
        .object([
            "width": .number(Double(width)), "height": .number(Double(height)), "every": .number(Double(every)),
            "maxFrames": .number(Double(maxFrames)), "format": .string("rgb24"), "path": .string(path),
        ])
    }

    private func run(_ params: JSONValue, _ scratch: DecodeScratch) async -> WorkResponse {
        await decodePass(params: params, progress: { _ in }, confinement: scratch.confinement)
    }

    private func bytes(_ path: String) -> Data { (try? Data(contentsOf: URL(fileURLWithPath: path))) ?? Data() }

    @Test func aWholeFileWritesEveryFrameAndPicksTheSets() async throws {
        let scratch = try DecodeScratch()
        try DecodeFixtures.h264(scratch.path("in.mp4"), frames: 64)
        let reply = await run(params(scratch, source: scratch.path("in.mp4"), analysis: scratch.path("a.nv12"),
                                     sets: [set(scratch.path("s.rgb"), width: 160, height: 90, every: 10, maxFrames: 5)]), scratch)
        let result = try #require(reply.result?.object)
        #expect(reply.failure == nil)
        #expect(result["frames"]?.number == 64)
        #expect(result["sets"]?.array?.first?.number == 5)
        #expect(bytes(scratch.path("a.nv12")).count == 64 * landscape)
        #expect(bytes(scratch.path("s.rgb")).count == 5 * smallRGB)
    }

    @Test func aWindowIsTheSameBytesAsThoseFramesOfTheWholeFile() async throws {
        let scratch = try DecodeScratch()
        try DecodeFixtures.h264(scratch.path("in.mp4"), frames: 64, gop: 12)
        let whole = await run(params(scratch, source: scratch.path("in.mp4"), analysis: scratch.path("whole.nv12")), scratch)
        #expect(whole.failure == nil)
        // Frame 30 sits mid-GOP: the decode starts at the keyframe before it and keeps nothing until frame 30.
        let window = await run(params(scratch, source: scratch.path("in.mp4"), analysis: scratch.path("part.nv12"),
                                      window: (30, 20)), scratch)
        #expect(window.result?.object?["frames"]?.number == 20)
        let frame = landscape
        let all = bytes(scratch.path("whole.nv12"))
        let part = bytes(scratch.path("part.nv12"))
        #expect(part.count == 20 * frame)
        #expect(all.count == 64 * frame)
        #expect(part == all.subdata(in: 30 * frame ..< 50 * frame))
    }

    @Test func aCancelEndsTheDecodeAndAnswersCancelled() async throws {
        let scratch = try DecodeScratch()
        try DecodeFixtures.h264(scratch.path("long.mp4"), width: 1280, height: 720, frames: 900, gop: 30)
        let request = params(scratch, source: scratch.path("long.mp4"), analysis: scratch.path("a.nv12"))
        let confinement = scratch.confinement
        let job = Task { await decodePass(params: request, progress: { _ in }, confinement: confinement) }
        try await Task.sleep(for: .milliseconds(150))
        job.cancel()
        let reply = await job.value
        #expect(reply.failure?.code == "helper.cancelled")
        // The session is gone: a new decode of the same file runs to the end.
        let again = await run(params(scratch, source: scratch.path("long.mp4"), analysis: scratch.path("b.nv12"),
                                     window: (0, 30)), scratch)
        #expect(again.result?.object?["frames"]?.number == 30)
    }

    @Test func aVariableRateClipIsOffTheGrid() async throws {
        let scratch = try DecodeScratch()
        // Frames 0–9 on a 30 fps grid, then a jump of five frame times: FFmpeg's fps filter would repeat frames here.
        try DecodeFixtures.h264(scratch.path("vfr.mp4"), frames: 30, extra: [
            "-vf", "setpts='if(lt(N,10),N,N+5)/30/TB'", "-fps_mode", "vfr",
        ])
        let reply = await run(params(scratch, source: scratch.path("vfr.mp4"), analysis: scratch.path("a.nv12")), scratch)
        #expect(reply.failure?.code == "decode.off_grid")
    }

    @Test func aCodecWithoutAHardwareRouteIsUnsupported() async throws {
        let scratch = try DecodeScratch()
        try DecodeFixtures.run([
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-frames:v", "10", "-c:v", "mjpeg", scratch.path("in.mov"),
        ])
        let reply = await run(params(scratch, source: scratch.path("in.mov"), analysis: scratch.path("a.nv12")), scratch)
        #expect(reply.failure?.code == "decode.unsupported")
    }

    @Test func aFifoReaderGetsEveryFrameAndAMissingReaderCanBeCancelled() async throws {
        let scratch = try DecodeScratch()
        try DecodeFixtures.h264(scratch.path("in.mp4"), frames: 40)
        let fifo = scratch.path("frames.fifo")
        #expect(mkfifo(fifo, 0o600) == 0)
        let reader = Task.detached { () -> Int in
            guard let handle = FileHandle(forReadingAtPath: fifo) else { return -1 }
            return handle.readDataToEndOfFile().count
        }
        let reply = await run(params(scratch, source: scratch.path("in.mp4"), analysis: fifo), scratch)
        #expect(reply.result?.object?["frames"]?.number == 40)
        let readBytes = await reader.value
        #expect(readBytes == 40 * landscape)
        let lonely = scratch.path("lonely.fifo")
        #expect(mkfifo(lonely, 0o600) == 0)
        let lonelyRequest = params(scratch, source: scratch.path("in.mp4"), analysis: lonely)
        let confinement = scratch.confinement
        let waiting = Task { await decodePass(params: lonelyRequest, progress: { _ in }, confinement: confinement) }
        try await Task.sleep(for: .milliseconds(100))
        waiting.cancel()
        let lonelyReply = await waiting.value
        #expect(lonelyReply.failure?.code == "helper.cancelled")
    }

    @Test func aStreamOfAnotherRangeIsDeclinedBeforeAnyFrame() async throws {
        let scratch = try DecodeScratch()
        try DecodeFixtures.h264(scratch.path("in.mp4"), frames: 12)
        guard case .object(var request) = params(scratch, source: scratch.path("in.mp4"), analysis: scratch.path("a.nv12"))
        else { return }
        request["range"] = .string("full")
        let reply = await run(.object(request), scratch)
        #expect(reply.failure?.code == "decode.unsupported")
        #expect(!FileManager.default.fileExists(atPath: scratch.path("a.nv12")))
    }

    @Test func aTurnedClipComesOutUpright() async throws {
        let scratch = try DecodeScratch()
        try DecodeFixtures.h264(scratch.path("in.mp4"), frames: 12)
        let reply = await run(params(scratch, source: scratch.path("in.mp4"), analysis: scratch.path("a.nv12"),
                                     width: 144, height: 256, rotation: 90), scratch)
        #expect(reply.result?.object?["frames"]?.number == 12)
        #expect(bytes(scratch.path("a.nv12")).count == 12 * portrait)
    }
}
