// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

/// `decode.frames`' pure parts: no decoder is opened here.
@Suite struct DecodeFramesUnitTests {
    private let rate = GridRate(num: 30, den: 1)

    @Test func framesCloserThanTheGapShareARead() {
        #expect(framesWindows([0, 5, 60, 61, 200], rate: rate, gapSeconds: 2) == [0 ... 61, 200 ... 200])
        #expect(framesWindows([0, 61], rate: rate, gapSeconds: 2) == [0 ... 0, 61 ... 61])
        #expect(framesWindows([0, 61], rate: rate, gapSeconds: 0) == [0 ... 0, 61 ... 61])
        #expect(framesWindows([], rate: rate, gapSeconds: 2).isEmpty)
    }

    @Test func paramsAreValidatedAndConfined() throws {
        let scratch = try DecodeScratch()
        let set: JSONValue = .object([
            "width": .number(768), "height": .number(384), "frames": .array([.number(3), .number(90)]),
            "path": .string(scratch.path("e.nv12")),
        ])
        let good: JSONValue = .object([
            "path": .string(scratch.path("in.mp4")), "rate": .object(["num": .number(30), "den": .number(1)]),
            "rotation": .number(90), "range": .string("full"), "gapSeconds": .number(2), "sets": .array([set]),
        ])
        guard case .success(let parsed) = parseDecodeFrames(good, confinement: scratch.confinement) else {
            Issue.record("valid params refused")
            return
        }
        #expect(parsed.rotation == 90)
        #expect(parsed.fullRange == true)
        #expect(parsed.sets.first?.frames == [3, 90])
        #expect(parsed.wanted == [3, 90])

        func refused(_ change: (inout [String: JSONValue]) -> Void) -> Bool {
            guard case .object(var object) = good else { return false }
            change(&object)
            if case .failure = parseDecodeFrames(.object(object), confinement: scratch.confinement) { return true }
            return false
        }
        func setWith(_ key: String, _ value: JSONValue) -> JSONValue {
            guard case .object(var object) = set else { return set }
            object[key] = value
            return .object(object)
        }
        #expect(refused { $0["path"] = .string("/etc/passwd") })
        #expect(refused { $0["rotation"] = .number(45) })
        #expect(refused { $0["sets"] = .array([]) })
        #expect(refused { $0["gapSeconds"] = .number(-1) })
        #expect(refused { $0["sets"] = .array([setWith("frames", .array([.number(9), .number(3)]))]) })
        #expect(refused { $0["sets"] = .array([setWith("frames", .array([.number(3), .number(3)]))]) })
        #expect(refused { $0["sets"] = .array([setWith("width", .number(767))]) })
        #expect(refused { $0["sets"] = .array([setWith("path", .string("/tmp/elsewhere.nv12"))]) })
    }
}

/// IX2-F16: rotation is a checked whole number in both decodes' params. `Int(1e20)` stopped the process, and every
/// VideoToolbox session it held with it; now it is a bad request, as 2^63 and a fraction are.
@Suite struct DecodeParamsNumberTests {
    @Test func rotationIsACheckedWholeNumberInBothDecodes() throws {
        #expect(whole(.number(1e20)) == nil)
        #expect(whole(.number(9_223_372_036_854_775_808.0)) == nil)
        #expect(whole(.number(90.5)) == nil)
        #expect(whole(.number(-90)) == -90)
        let scratch = try DecodeScratch()
        let common: [String: JSONValue] = [
            "path": .string(scratch.path("in.mp4")), "rate": .object(["num": .number(30), "den": .number(1)]),
        ]
        let frames = common.merging([
            "sets": .array([.object([
                "width": .number(256), "height": .number(144), "frames": .array([.number(1)]),
                "path": .string(scratch.path("f.nv12")),
            ])]),
        ]) { first, _ in first }
        let pass = common.merging([
            "analysis": .object(["width": .number(256), "height": .number(144), "path": .string(scratch.path("a.nv12"))]),
        ]) { first, _ in first }
        func code<T>(_ result: Result<T, HelperFailure>) -> String? {
            if case .failure(let failure) = result { return failure.code }
            return nil
        }
        func parsed(_ rotation: JSONValue) -> [String?] {
            [
                code(parseDecodeFrames(.object(frames.merging(["rotation": rotation]) { _, new in new }),
                                       confinement: scratch.confinement)),
                code(parseDecodePass(.object(pass.merging(["rotation": rotation]) { _, new in new }),
                                     confinement: scratch.confinement)),
            ]
        }
        #expect(parsed(.number(90)) == [nil, nil])
        for rotation: JSONValue in [.number(1e20), .number(-1e20), .number(9.3e18), .number(90.5), .string("90"), .null] {
            #expect(parsed(rotation) == ["helper.bad_request", "helper.bad_request"], "\(rotation)")
        }
    }
}

/// `decode.frames` end to end on clips the bundled FFmpeg encodes in software at test time: the frames are the very
/// bytes `decode.pass` writes for the same grid frames at the same size, wherever the read starts. These decode with
/// VideoToolbox: run them under the machine's VideoToolbox lock (`swift test --filter DecodeFramesTests`). Serialized:
/// one decode session at a time.
@Suite(.serialized, .enabled(if: DecodeFixtures.available, "needs the bundled FFmpeg (tools/ffmpeg/dist) to make fixtures"))
struct DecodeFramesTests {
    private let rate: JSONValue = .object(["num": .number(30), "den": .number(1)])
    private let frame = 256 * 144 * 3 / 2

    private func framesParams(_ scratch: DecodeScratch, source: String, frames: [Int], rotation: Int = 0,
                              width: Int = 256, height: Int = 144, range: String? = nil) -> JSONValue {
        var params: [String: JSONValue] = [
            "path": .string(source), "rate": rate, "rotation": .number(Double(rotation)), "gapSeconds": .number(2),
            "sets": .array([.object([
                "width": .number(Double(width)), "height": .number(Double(height)),
                "frames": .array(frames.map { .number(Double($0)) }), "path": .string(scratch.path("f.nv12")),
            ])]),
        ]
        if let range { params["range"] = .string(range) }
        return .object(params)
    }

    private func whole(_ scratch: DecodeScratch, source: String) async -> Data {
        let params: JSONValue = .object([
            "path": .string(source), "rate": rate, "rotation": .number(0),
            "analysis": .object(["width": .number(256), "height": .number(144), "path": .string(scratch.path("all.nv12"))]),
            "sets": .array([]),
        ])
        _ = await decodePass(params: params, progress: { _ in }, confinement: scratch.confinement)
        return (try? Data(contentsOf: URL(fileURLWithPath: scratch.path("all.nv12")))) ?? Data()
    }

    @Test func framesAcrossReadsAreThePassFramesByteForByte() async throws {
        let scratch = try DecodeScratch()
        // 300 frames, a keyframe every 12: reads of [0…13], [100…107], [230], [299]; mid-GOP starts; 310 is past the end.
        try DecodeFixtures.h264(scratch.path("in.mp4"), width: 640, height: 360, frames: 300, gop: 12)
        let wanted = [0, 5, 13, 100, 107, 230, 299, 310]
        let reply = await decodeFrames(params: framesParams(scratch, source: scratch.path("in.mp4"), frames: wanted),
                                       progress: { _ in }, confinement: scratch.confinement)
        #expect(reply.failure == nil)
        let result = try #require(reply.result?.object)
        #expect(result["written"]?.array?.first?.array?.compactMap(\.number) == [0, 5, 13, 100, 107, 230, 299])
        #expect(result["reads"]?.number == 4)
        let all = await whole(scratch, source: scratch.path("in.mp4"))
        #expect(all.count == 300 * frame)
        let got = try Data(contentsOf: URL(fileURLWithPath: scratch.path("f.nv12")))
        #expect(got.count == 7 * frame)
        for (k, index) in wanted.dropLast().enumerated() {
            #expect(got.subdata(in: k * frame ..< (k + 1) * frame) == all.subdata(in: index * frame ..< (index + 1) * frame),
                    "frame \(index)")
        }
    }

    @Test func aTurnedClipComesOutUprightAndACancelAnswersCancelled() async throws {
        let scratch = try DecodeScratch()
        try DecodeFixtures.h264(scratch.path("in.mp4"), frames: 60)
        let turned = await decodeFrames(
            params: framesParams(scratch, source: scratch.path("in.mp4"), frames: [1, 40], rotation: 90, width: 144, height: 256),
            progress: { _ in }, confinement: scratch.confinement)
        #expect(turned.failure == nil)
        #expect(((try? Data(contentsOf: URL(fileURLWithPath: scratch.path("f.nv12"))))?.count ?? 0) == 2 * frame)

        try DecodeFixtures.h264(scratch.path("long.mp4"), width: 1280, height: 720, frames: 900, gop: 30)
        let request = framesParams(scratch, source: scratch.path("long.mp4"), frames: Array(stride(from: 0, to: 900, by: 3)))
        let confinement = scratch.confinement
        let job = Task { await decodeFrames(params: request, progress: { _ in }, confinement: confinement) }
        try await Task.sleep(for: .milliseconds(150))
        job.cancel()
        #expect(await job.value.failure?.code == "helper.cancelled")
    }

    /// Clips the service doesn't read as FFmpeg does are left to it: timing FFmpeg's `fps` filter decides is
    /// `decode.off_grid`, another range is `decode.unsupported`; a read that doesn't meet the odd picture still
    /// answers (`FramesClip.all`).
    @Test(arguments: FramesClip.all)
    func aClipTheServiceDoesNotReadAsFfmpegIsLeftToIt(_ clip: FramesClip) async throws {
        let scratch = try DecodeScratch()
        try DecodeFixtures.h264(scratch.path("in.mp4"), frames: clip.frames, extra: clip.encode)
        let params = framesParams(scratch, source: scratch.path("in.mp4"), frames: clip.wanted, range: clip.range)
        let reply = await decodeFrames(params: params, progress: { _ in }, confinement: scratch.confinement)
        #expect(reply.failure?.code == clip.answer)
    }
}

/// A fixture clip, the frames and range asked of it, and the failure code `decode.frames` answers (nil: none).
struct FramesClip: Sendable, CustomTestStringConvertible {
    let name: String
    let frames: Int
    var encode: [String] = []
    let wanted: [Int]
    var range: String?
    let answer: String?
    var testDescription: String { name }

    static let all = [
        FramesClip(name: "another range", frames: 12, wanted: [1], range: "full", answer: "decode.unsupported"),
        // A gap of five frames inside one read: frame 12 is never shown.
        FramesClip(name: "a gap inside a read", frames: 30,
                   encode: ["-vf", "setpts='if(lt(N,10),N,N+5)/30/TB'", "-fps_mode", "vfr"],
                   wanted: [12, 20], answer: "decode.off_grid"),
        // IX2-F16: frames 0–9 on the grid, then a hole (the tenth frame at slot 110). Frame 50's read, a window of its
        // own, decodes only 0–9; 130's decodes past 50, which used to be left out of a successful reply.
        FramesClip(name: "a read that decodes no picture", frames: 40,
                   encode: ["-vf", "setpts='if(lt(N,10),N,N+100)/30/TB'", "-fps_mode", "vfr"],
                   wanted: [50, 130], answer: "decode.off_grid"),
        // IX2-F16: the sixth frame shown 0.4 of a frame late (slot 5.4), in frame 10's pre-roll, which used to skip
        // it; a read from the next keyframe (12) for frame 20 never meets it. The encoder's time base would otherwise
        // be 1/30 and round 5.4 back onto its slot.
        FramesClip(name: "a pre-roll picture off its slot", frames: 30, encode: lateSixth, wanted: [10],
                   answer: "decode.off_grid"),
        FramesClip(name: "a read past the late picture", frames: 30, encode: lateSixth, wanted: [20], answer: nil),
    ]

    private static let lateSixth = [
        "-vf", "settb=1/3000,setpts='if(eq(N,5),5.4,N)/30/TB'", "-fps_mode", "vfr",
        "-enc_time_base", "1/3000", "-video_track_timescale", "3000",
    ]
}
