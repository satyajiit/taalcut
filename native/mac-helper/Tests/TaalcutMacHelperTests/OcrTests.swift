// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreGraphics
import Foundation
import Testing

@testable import TaalcutMacHelper

@Suite(.serialized) struct OcrTests {
    @Test(arguments: [
        Sample("Hello Taalcut", 48, true, "en"),
        Sample("Hello Taalcut", 96, false, "en"),
        Sample("Hola Taalcut", 72, true, "es"),
        Sample("Obrigado", 72, false, "pt"),
    ])
    func latinFrameMatchesTheDrawing(_ sample: Sample) async throws {
        let root = FileManager.default.temporaryDirectory
        let drawn = try drawText(text: sample.text, pointSize: sample.points, lightOnDark: sample.lightOnDark)
        defer { try? FileManager.default.removeItem(at: drawn.url) }
        let response = await OcrEngine().recognize(sample.params(drawn.url), confinement: PathConfinement(roots: [root.path]))
        let image = try #require(response.result?.key("images")?.array?.first)
        #expect(response.result?.key("boxSpace")?.string == "normalized-lower-left")
        #expect(response.result?.key("api")?.string == "RecognizeTextRequest")
        #expect(image.key("path")?.string == drawn.url.path)
        let observations = try #require(image.key("observations")?.array)
        let text = observations.compactMap { $0.key("text")?.string }.joined(separator: " ")
        #expect(text == sample.text)
        for observation in observations {
            let confidence = try #require(observation.key("confidence")?.number)
            #expect(confidence >= 0 && confidence <= 1)
            // FIX-SIGN: level text drawn flat comes with four corners, level within a hair.
            let quad = try #require(observation.key("quad")?.array)
            #expect(quad.count == 4)
            let top = quad.compactMap { $0.key("y")?.number }
            #expect(top.count == 4 && abs(top[0] - top[1]) <= 0.01 && abs(top[2] - top[3]) <= 0.01)
        }
        let box = try unionBox(observations)
        #expect(abs(box.minX - drawn.box.minX) <= 0.02)
        #expect(abs(box.minY - drawn.box.minY) <= 0.02)
        #expect(abs(box.width - drawn.box.width) <= 0.02)
        #expect(abs(box.height - drawn.box.height) <= 0.02)
    }

    @Test func legacyRequestIsAvailableInTestBuilds() async throws {
        let root = FileManager.default.temporaryDirectory
        let drawn = try drawText(text: "Hello Taalcut", pointSize: 72, lightOnDark: true)
        defer { try? FileManager.default.removeItem(at: drawn.url) }
        let engine = OcrEngine(forceLegacy: true)
        #expect(engine.apiName == "VNRecognizeTextRequest")
        let response = await engine.recognize(
            Sample("Hello Taalcut", 72, true, "en").params(drawn.url),
            confinement: PathConfinement(roots: [root.path]))
        #expect(response.result?.key("api")?.string == "VNRecognizeTextRequest")
        let text = response.result?.key("images")?.array?.first?.key("observations")?.array?
            .compactMap { $0.key("text")?.string }.joined(separator: " ")
        #expect(text == "Hello Taalcut")
    }

    /// FIX-OCRCOLD: macOS 27.2's Vision lists `hi` and `mr`. Where the OS lists Hindi, a Devanagari frame asked for in
    /// Hindi is read in Devanagari, text and box; where it doesn't (macOS 14 to 26), `hi` is refused with the list.
    @Test func hindiIsReadWhereTheOsListsItAndRefusedWhereNot() async throws {
        let engine = OcrEngine()
        let listsHindi = engine.supportedIdentifiers(fast: false).contains { $0.lowercased() == "hi" }
        let root = FileManager.default.temporaryDirectory
        let drawn = try drawText(text: "नमस्ते दुनिया", pointSize: 72, lightOnDark: true, devanagari: true)
        defer { try? FileManager.default.removeItem(at: drawn.url) }
        let response = await engine.recognize(
            .object([
                "paths": .array([.string(drawn.url.path)]),
                "languages": .array([.string("hi")]),
                "minimumTextHeight": .number(0),
            ]),
            confinement: PathConfinement(roots: [root.path]))
        guard listsHindi else {
            #expect(response.failure?.code == "ocr.language_unsupported")
            let supported = response.failure?.supported ?? []
            #expect(!supported.isEmpty)
            #expect(supported.contains { $0.lowercased() == "hi" } == false)
            return
        }
        let observations = try #require(response.result?.key("images")?.array?.first?.key("observations")?.array)
        #expect(observations.compactMap { $0.key("text")?.string }.joined(separator: " ") == drawn.text)
        let box = try unionBox(observations)
        #expect(abs(box.minX - drawn.box.minX) <= 0.02)
        #expect(abs(box.minY - drawn.box.minY) <= 0.02)
        #expect(abs(box.width - drawn.box.width) <= 0.02)
        #expect(abs(box.height - drawn.box.height) <= 0.02)
    }

    /// A Devanagari frame asked for in English: Vision detects the script where the OS lists it (its readings are
    /// Devanagari), and returns no Devanagari scalar where it doesn't (spike 05, macOS 14 to 26).
    @Test func devanagariFrameFollowsTheSupportedList() async throws {
        let engine = OcrEngine()
        let listsDevanagari = engine.supportedIdentifiers(fast: false).contains {
            ["hi", "mr"].contains($0.lowercased())
        }
        let root = FileManager.default.temporaryDirectory
        let drawn = try drawText(text: "नमस्ते दुनिया", pointSize: 72, lightOnDark: true, devanagari: true)
        defer { try? FileManager.default.removeItem(at: drawn.url) }
        let response = await engine.recognize(
            .object([
                "paths": .array([.string(drawn.url.path)]),
                "languages": .array([.string("en")]),
                "minimumTextHeight": .number(0),
            ]),
            confinement: PathConfinement(roots: [root.path]))
        let observations = response.result?.key("images")?.array?.first?.key("observations")?.array ?? []
        let scalars = observations.compactMap { $0.key("text")?.string }.joined().unicodeScalars
        #expect(scalars.contains { (0x0900...0x097F).contains($0.value) } == listsDevanagari)
    }

    /// The warm-up's canvases, read by Vision on this Mac: each step reads its line (OcrWarmup.swift).
    @Test func warmUpCanvasesAreRead() async throws {
        let engine = OcrEngine()
        for step in warmSteps(supported: engine.supportedIdentifiers(fast: false)) {
            let canvas = try #require(warmCanvas(step))
            let read = await engine.warm(canvas, languages: step.languages)
            #expect(((try? read.get()) ?? 0) >= 1, "\(step.script)")
        }
    }
}

struct Sample: Sendable, CustomTestStringConvertible {
    var text: String
    var points: CGFloat
    var lightOnDark: Bool
    var language: String
    var testDescription: String { "\(language) \(Int(points))pt" }

    init(_ text: String, _ points: CGFloat, _ lightOnDark: Bool, _ language: String) {
        self.text = text
        self.points = points
        self.lightOnDark = lightOnDark
        self.language = language
    }

    func params(_ url: URL) -> JSONValue {
        .object([
            "paths": .array([.string(url.path)]),
            "languages": .array([.string(language)]),
            "languageCorrection": .bool(false),
            "minimumTextHeight": .number(0),
            "customWords": .array([.string("Taalcut")]),
        ])
    }
}

private func unionBox(_ observations: [JSONValue]) throws -> CGRect {
    let rects = try observations.map { observation -> CGRect in
        let box = try #require(observation.key("box")?.object)
        return CGRect(
            x: try #require(box["x"]?.number), y: try #require(box["y"]?.number),
            width: try #require(box["width"]?.number), height: try #require(box["height"]?.number))
    }
    return try #require(rects.first).union(rects.dropFirst().reduce(CGRect.null) { $0.union($1) })
}
