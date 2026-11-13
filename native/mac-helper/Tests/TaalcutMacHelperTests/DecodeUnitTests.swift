// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreMedia
import CoreVideo
import Foundation
import Testing

@testable import TaalcutMacHelper

/// The decode service's pure parts: no decoder is opened here.
@Suite struct DecodeUnitTests {
    private let rate = GridRate(num: 30, den: 1)

    private func time(_ frame: Double, rate: GridRate = GridRate(num: 30, den: 1), origin: Double = 0) -> CMTime {
        CMTime(seconds: origin + frame / rate.framesPerSecond, preferredTimescale: 90_000)
    }

    @Test func wholeFileFramesTakeConsecutiveSlots() {
        var grid = GridIndexer(origin: .zero, rate: rate, window: nil)
        #expect(grid.place(time(0)) == .frame(0))
        #expect(grid.place(time(1)) == .frame(1))
        #expect(grid.place(time(2.1)) == .frame(2))
        #expect(grid.placed == 3)
    }

    @Test func aWindowSkipsPreRollAndStopsAtItsEnd() {
        var grid = GridIndexer(origin: time(0, origin: 0.5), rate: rate, window: PassWindow(from: 10, frames: 2))
        #expect(grid.place(time(8, origin: 0.5)) == .before)
        #expect(grid.place(time(9, origin: 0.5)) == .before)
        #expect(grid.place(time(10, origin: 0.5)) == .frame(10))
        #expect(grid.place(time(11, origin: 0.5)) == .frame(11))
        #expect(grid.place(time(12, origin: 0.5)) == .after)
        #expect(grid.placed == 2)
    }

    @Test func aGapARepeatOrAFrameBetweenSlotsIsOffTheGrid() {
        var gap = GridIndexer(origin: .zero, rate: rate, window: nil)
        _ = gap.place(time(0))
        #expect(gap.place(time(2)) == .offGrid(found: 2, expected: 1))
        var repeated = GridIndexer(origin: .zero, rate: rate, window: nil)
        _ = repeated.place(time(0))
        _ = repeated.place(time(1))
        #expect(repeated.place(time(1)) == .offGrid(found: 1, expected: 2))
        var between = GridIndexer(origin: .zero, rate: rate, window: nil)
        #expect(between.place(time(0.4)) == .offGrid(found: 0, expected: 0))
        var first = GridIndexer(origin: .zero, rate: rate, window: nil)
        #expect(first.place(time(1)) == .offGrid(found: 1, expected: 0))
    }

    @Test func ntscRatesStayOnTheGrid() {
        let ntsc = GridRate(num: 30000, den: 1001)
        var grid = GridIndexer(origin: .zero, rate: ntsc, window: nil)
        for frame in 0 ..< 3000 {
            let at = CMTime(value: CMTimeValue(frame * 1001), timescale: 30000)
            #expect(grid.place(at) == .frame(frame))
        }
    }

    @Test func paramsAreValidatedAndConfined() throws {
        let scratch = try DecodeScratch()
        let good: JSONValue = .object([
            "path": .string(scratch.path("in.mp4")),
            "rate": .object(["num": .number(30000), "den": .number(1001)]),
            "window": .object(["from": .number(30), "frames": .number(60)]),
            "rotation": .number(90),
            "analysis": .object(["width": .number(144), "height": .number(256), "path": .string(scratch.path("a.nv12"))]),
            "sets": .array([.object([
                "width": .number(48), "height": .number(27), "every": .number(1), "maxFrames": .number(10),
                "format": .string("rgb24"), "path": .string(scratch.path("s.raw")),
            ])]),
        ])
        let parsed = try parseDecodePass(good, confinement: scratch.confinement).get()
        #expect(parsed.rate == GridRate(num: 30000, den: 1001))
        #expect(parsed.window == PassWindow(from: 30, frames: 60))
        #expect(parsed.rotation == 90)
        #expect(parsed.sets.first?.format == .rgb24)
        #expect(parsed.fullRange == nil)
        func code(_ change: (inout [String: JSONValue]) -> Void) -> String? {
            guard var object = good.object else { return nil }
            change(&object)
            guard case .failure(let failure) = parseDecodePass(.object(object), confinement: scratch.confinement) else {
                return nil
            }
            return failure.code
        }
        #expect(code { $0["path"] = .string("/etc/hosts") } == "helper.path_not_allowed")
        #expect(code { $0["rotation"] = .number(45) } == "helper.bad_request")
        #expect(code { $0["range"] = .string("pc") } == "helper.bad_request")
        #expect(code { $0["range"] = .string("video") } == nil)
        #expect(code { $0["rate"] = .object(["num": .number(0), "den": .number(1)]) } == "helper.bad_request")
        #expect(code {
            $0["analysis"] = .object(["width": .number(255), "height": .number(144), "path": .string(scratch.path("a"))])
        } == "helper.bad_request")
        #expect(code { $0["sets"] = .array(Array(repeating: .object([:]), count: 9)) } == "helper.bad_request")
    }

    @Test func nv12IsPackedWithoutRowPadding() throws {
        let luma: (Int, Int) -> UInt8 = { x, y in UInt8(10 * y + x) }
        let chroma: (Int, Int) -> (UInt8, UInt8) = { x, y in (UInt8(100 + 10 * y + x), UInt8(200 + 10 * y + x)) }
        let made = makeNV12(width: 6, height: 4, luma: luma, chroma: chroma)
        let buffer = try #require(made)
        var out: [UInt8] = []
        packNV12(buffer, into: &out)
        #expect(out.count == 6 * 4 + 6 * 2)
        #expect(Array(out[0 ..< 6]) == [0, 1, 2, 3, 4, 5])
        #expect(Array(out[18 ..< 24]) == [30, 31, 32, 33, 34, 35])
        #expect(Array(out[24 ..< 30]) == [100, 200, 101, 201, 102, 202])
        #expect(Array(out[30 ..< 36]) == [110, 210, 111, 211, 112, 212])
        packNV12(buffer, into: &out, lumaOnly: true)
        #expect(out.count == 24)
    }

    @Test func coloursConvertForBothRangesAndMatrices() throws {
        let format = try videoFormat(matrix: nil)
        let limited = YCbCrToRGB.forStream(format, fullRange: false)
        let white = try #require(flat(luma: 235))
        let black = try #require(flat(luma: 16))
        let red = try #require(flat(luma: 81, cb: 90, cr: 240))
        var out: [UInt8] = []
        limited.pack(white, into: &out)
        #expect(out == Array(repeating: 255, count: 12))
        limited.pack(black, into: &out)
        #expect(out == Array(repeating: 0, count: 12))
        limited.pack(red, into: &out)
        #expect(abs(Int(out[0]) - 255) <= 1 && out[1] <= 1 && out[2] <= 1)
        let full = YCbCrToRGB.forStream(format, fullRange: true)
        let fullWhite = try #require(flat(luma: 255, fullRange: true))
        full.pack(fullWhite, into: &out)
        #expect(out == Array(repeating: 255, count: 12))
        let hd = YCbCrToRGB.forStream(try videoFormat(matrix: kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2), fullRange: false)
        #expect(abs(hd.crToR - 1.5748 * 255 / 224) < 0.001)
        #expect(abs(limited.crToR - 1.402 * 255 / 224) < 0.001)
        // Gray sets in FFmpeg's full-range levels: video-range luma stretched as swscale does, full range kept.
        #expect([16, 17, 100, 128, 235, 240].map { stretchedLuma(UInt8($0)) } == [0, 1, 98, 130, 255, 255])
        #expect(full.grayLevels == (0 ... 255).map { UInt8($0) })
        limited.packGray(white, into: &out)
        #expect(out == [255, 255, 255, 255])
    }

    @Test func failuresMapToTheCodesMediaReads() {
        #expect(PassFailure.unsupported("x").helperFailure.code == "decode.unsupported")
        #expect(PassFailure.offGrid(found: 3, expected: 2).helperFailure.code == "decode.off_grid")
        #expect(PassFailure.malfunction(-17691).helperFailure.code == "decode.session_malfunction")
        #expect(PassFailure.outputClosed("x").helperFailure.retryable)
        #expect(PassFailure.cancelled.helperFailure.code == "helper.cancelled")
        #expect(HelperService.forMethod("decode.pass") == .decode)
        #expect(HelperService.decode.slots == 3)
        #expect(HelperService.decode.holdsVideoSession && HelperService.track.holdsVideoSession)
        #expect(!HelperService.ocr.holdsVideoSession)
    }

    private func flat(luma: UInt8, cb: UInt8 = 128, cr: UInt8 = 128, fullRange: Bool = false) -> CVPixelBuffer? {
        let lumaFill: (Int, Int) -> UInt8 = { _, _ in luma }
        let chromaFill: (Int, Int) -> (UInt8, UInt8) = { _, _ in (cb, cr) }
        return makeNV12(width: 2, height: 2, fullRange: fullRange, luma: lumaFill, chroma: chromaFill)
    }

    private func videoFormat(matrix: CFString?) throws -> CMFormatDescription {
        var extensions: [CFString: Any] = [:]
        if let matrix { extensions[kCMFormatDescriptionExtension_YCbCrMatrix] = matrix }
        var format: CMFormatDescription?
        let status = CMVideoFormatDescriptionCreate(
            allocator: nil, codecType: kCMVideoCodecType_H264, width: 2, height: 2,
            extensions: extensions as CFDictionary, formatDescriptionOut: &format)
        return try #require(status == noErr ? format : nil)
    }
}
