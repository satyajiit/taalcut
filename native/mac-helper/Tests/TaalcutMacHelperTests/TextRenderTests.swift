// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

@Suite struct TextRenderTests {
    @Test func rendersBothPolaritiesAsGrayPNGs() async throws {
        let font = try copiedFont()
        let root = font.deletingLastPathComponent()
        let confinement = PathConfinement(roots: [root.path])
        let dark = root.appendingPathComponent("dark.png")
        let light = root.appendingPathComponent("light.png")
        let darkResponse = await renderMatchedText(
            params: textParams("Ag", font: font, output: dark, pixelHeight: 48, polarity: "darkOnLight"),
            confinement: confinement)
        let lightResponse = await renderMatchedText(
            params: textParams("Ag", font: font, output: light, pixelHeight: 48, polarity: "lightOnDark"),
            confinement: confinement)
        try assertGrayPNG(darkResponse, file: dark)
        try assertGrayPNG(lightResponse, file: light)
        try assertInkInside(darkResponse)
        try assertInkInside(lightResponse)
        let darkInk = try #require(darkResponse.result?.key("inkBox")?.key("width")?.number)
        #expect(darkInk > 0)
    }

    @Test func spacesHaveAnEmptyInkBox() async throws {
        let font = try copiedFont()
        let root = font.deletingLastPathComponent()
        let output = root.appendingPathComponent("spaces.png")
        let response = await renderMatchedText(
            params: textParams("   ", font: font, output: output, pixelHeight: 32, polarity: "darkOnLight"),
            confinement: PathConfinement(roots: [root.path]))
        #expect(response.failure == nil)
        let box = try #require(response.result?.key("inkBox"))
        #expect(box.key("x")?.number == 0)
        #expect(box.key("y")?.number == 0)
        #expect(box.key("width")?.number == 0)
        #expect(box.key("height")?.number == 0)
    }

    @Test func rejectsBadStringsSizesAndPolarity() async throws {
        let root = try ScratchDir()
        let font = root.url.appendingPathComponent("missing.ttf")
        let output = root.url.appendingPathComponent("out.png")
        let confinement = PathConfinement(roots: [root.url.path])
        let empty = await renderMatchedText(
            params: textParams("", font: font, output: output, pixelHeight: 24, polarity: "darkOnLight"),
            confinement: confinement)
        #expect(empty.failure?.code == "text.bad_string")
        #expect(empty.failure?.retryable == false)
        let long = String(repeating: "a", count: 401)
        let tooLong = await renderMatchedText(
            params: textParams(long, font: font, output: output, pixelHeight: 24, polarity: "darkOnLight"),
            confinement: confinement)
        #expect(tooLong.failure?.code == "helper.bad_request")
        for height in [23.0, 257.0, 24.5] {
            let response = await renderMatchedText(
                params: textParams("a", font: font, output: output, pixelHeight: height, polarity: "darkOnLight"),
                confinement: confinement)
            #expect(response.failure?.code == "helper.bad_request")
        }
        let polarity = await renderMatchedText(
            params: textParams("a", font: font, output: output, pixelHeight: 24, polarity: "blue"),
            confinement: confinement)
        #expect(polarity.failure?.code == "helper.bad_request")
    }

    @Test func missingFontAndOutsidePath() async throws {
        let root = try ScratchDir()
        let confinement = PathConfinement(roots: [root.url.path])
        let missing = await renderMatchedText(
            params: textParams(
                "a", font: root.url.appendingPathComponent("no-such.ttf"),
                output: root.url.appendingPathComponent("out.png"), pixelHeight: 24, polarity: "darkOnLight"),
            confinement: confinement)
        #expect(missing.failure?.code == "text.font_unreadable")
        let outside = await renderMatchedText(
            params: textParams(
                "a", font: URL(fileURLWithPath: "/etc/passwd"),
                output: root.url.appendingPathComponent("out.png"), pixelHeight: 24, polarity: "darkOnLight"),
            confinement: confinement)
        #expect(outside.failure?.code == "helper.path_not_allowed")
    }
}

private func copiedFont() throws -> URL {
    let candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Geneva.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    ]
    guard let source = candidates.map({ URL(fileURLWithPath: $0) }).first(where: {
        FileManager.default.fileExists(atPath: $0.path)
    }) else {
        Issue.record("no system font to copy")
        throw ScratchError.missingFont
    }
    let root = try ScratchDir()
    let copy = root.url.appendingPathComponent("face.ttf")
    try FileManager.default.copyItem(at: source, to: copy)
    return copy
}

private func textParams(
    _ string: String, font: URL, output: URL, pixelHeight: Double, polarity: String
) -> JSONValue {
    .object([
        "string": .string(string),
        "fontFile": .string(font.path),
        "pixelHeight": .number(pixelHeight),
        "polarity": .string(polarity),
        "output": .string(output.path),
    ])
}

private func assertGrayPNG(_ response: WorkResponse, file: URL) throws {
    #expect(response.failure == nil)
    let data = try Data(contentsOf: file)
    #expect(data.starts(with: [0x89, 0x50, 0x4E, 0x47]))
    #expect(data.count > 25)
    #expect(data[24] == 8)
    #expect(data[25] == 0)
}

private func assertInkInside(_ response: WorkResponse) throws {
    let result = try #require(response.result)
    let width = try #require(result.key("width")?.number)
    let height = try #require(result.key("height")?.number)
    let box = try #require(result.key("inkBox"))
    let x = try #require(box.key("x")?.number)
    let y = try #require(box.key("y")?.number)
    let boxWidth = try #require(box.key("width")?.number)
    let boxHeight = try #require(box.key("height")?.number)
    #expect(x >= 0 && y >= 0)
    #expect(x + boxWidth <= width)
    #expect(y + boxHeight <= height)
}

private struct ScratchDir {
    let url: URL
    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-text-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}

private enum ScratchError: Error {
    case missingFont
}
