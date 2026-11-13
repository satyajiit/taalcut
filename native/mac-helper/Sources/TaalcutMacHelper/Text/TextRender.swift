// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

private let minimumPixelHeight = 24
private let maximumPixelHeight = 256
private let maximumCharacters = 400

func renderMatchedText(params: JSONValue, confinement: PathConfinement) async -> WorkResponse {
    guard let text = params.key("string")?.string else {
        return .fail(.failed("text.bad_string", "string is empty", retryable: false))
    }
    if text.isEmpty {
        return .fail(.failed("text.bad_string", "string is empty", retryable: false))
    }
    if text.count > maximumCharacters {
        return .fail(.badRequest("string is longer than \(maximumCharacters) characters"))
    }
    guard let pixelHeight = wholeInteger(params.key("pixelHeight"), name: "pixelHeight"),
        (minimumPixelHeight...maximumPixelHeight).contains(pixelHeight)
    else {
        return .fail(.badRequest("pixelHeight must be an integer from \(minimumPixelHeight) to \(maximumPixelHeight)"))
    }
    guard let polarity = params.key("polarity")?.string, let ink = InkPolarity(rawValue: polarity) else {
        return .fail(.badRequest("polarity must be darkOnLight or lightOnDark"))
    }
    guard let fontPath = params.key("fontFile")?.string, let outputPath = params.key("output")?.string else {
        return .fail(.badRequest("fontFile and output are required"))
    }
    switch confinement.resolve(fontPath) {
    case .failure(let failure):
        return .fail(failure)
    case .success(let fontURL):
        switch resolveOutput(outputPath, confinement: confinement) {
        case .failure(let failure):
            return .fail(failure)
        case .success(let outputURL):
            return drawMatchedText(text, fontURL: fontURL, outputURL: outputURL, pixelHeight: pixelHeight, ink: ink)
        }
    }
}

private enum InkPolarity: String {
    case darkOnLight
    case lightOnDark

    var foreground: CGFloat { self == .darkOnLight ? 0 : 1 }
    var background: CGFloat { self == .darkOnLight ? 1 : 0 }
}

private func wholeInteger(_ value: JSONValue?, name: String) -> Int? {
    _ = name
    // Checked (TrackShot.swift's `whole`): `Int(1e20)` would stop the process (IX2-F16).
    return whole(value)
}

private func resolveOutput(_ path: String, confinement: PathConfinement) -> Result<URL, HelperFailure> {
    switch confinement.resolve(path) {
    case .failure(let failure):
        return .failure(failure)
    case .success(let url):
        var isDirectory: ObjCBool = false
        let parent = url.deletingLastPathComponent().path
        guard FileManager.default.fileExists(atPath: parent, isDirectory: &isDirectory), isDirectory.boolValue else {
            return .failure(.badRequest("output parent does not exist"))
        }
        return .success(url)
    }
}

private func drawMatchedText(
    _ text: String, fontURL: URL, outputURL: URL, pixelHeight: Int, ink: InkPolarity
) -> WorkResponse {
    guard FileManager.default.fileExists(atPath: fontURL.path) else {
        return .fail(.failed("text.font_unreadable", "font file is missing", retryable: false))
    }
    guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(fontURL as CFURL) as? [CTFontDescriptor],
        let descriptor = descriptors.first
    else {
        return .fail(.failed("text.font_unreadable", "font file has no descriptor", retryable: false))
    }
    let font = CTFontCreateWithFontDescriptor(descriptor, CGFloat(pixelHeight), nil)
    let ascent = CTFontGetAscent(font)
    let descent = CTFontGetDescent(font)
    let xHeight = CTFontGetXHeight(font)
    let line = CTLineCreateWithAttributedString(attributed(text, font: font, gray: ink.foreground))
    var lineAscent: CGFloat = 0
    var lineDescent: CGFloat = 0
    var leading: CGFloat = 0
    let advance = CTLineGetTypographicBounds(line, &lineAscent, &lineDescent, &leading)
    let width = max(2, Int(ceil(advance)) + 2)
    let height = max(2, Int(ceil(ascent + descent)) + 2)
    guard let context = grayContext(width: width, height: height) else {
        return .fail(.failed("text.font_unreadable", "could not allocate a canvas", retryable: false))
    }
    context.setShouldAntialias(true)
    context.setShouldSmoothFonts(false)
    context.setAllowsFontSmoothing(false)
    context.setFillColor(gray: ink.background, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.textMatrix = .identity
    context.textPosition = CGPoint(x: 1, y: 1 + descent)
    CTLineDraw(line, context)
    guard let image = context.makeImage(), writePNG(image, to: outputURL) else {
        return .fail(.failed("text.font_unreadable", "could not write the png", retryable: false))
    }
    let box = inkBox(context: context, width: width, height: height, background: ink.background)
    return .ok(.object([
        "output": .string(outputURL.path),
        "width": .number(Double(width)),
        "height": .number(Double(height)),
        "ascent": .number(Double(ascent)),
        "descent": .number(Double(descent)),
        "xHeight": .number(Double(xHeight)),
        "inkBox": .object([
            "x": .number(Double(box.x)),
            "y": .number(Double(box.y)),
            "width": .number(Double(box.width)),
            "height": .number(Double(box.height)),
        ]),
    ]))
}

private func attributed(_ text: String, font: CTFont, gray: CGFloat) -> CFAttributedString {
    let color = CGColor(gray: gray, alpha: 1)
    let value = NSAttributedString(string: text, attributes: [
        kCTFontAttributeName as NSAttributedString.Key: font,
        kCTForegroundColorAttributeName as NSAttributedString.Key: color,
    ])
    return value
}

private func grayContext(width: Int, height: Int) -> CGContext? {
    CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width,
        space: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGImageAlphaInfo.none.rawValue)
}

private func writePNG(_ image: CGImage, to url: URL) -> Bool {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        return false
    }
    CGImageDestinationAddImage(destination, image, nil)
    return CGImageDestinationFinalize(destination)
}

/// Tight bounds of pixels that are not the flat background. Origin is the top left of the PNG.
private func inkBox(context: CGContext, width: Int, height: Int, background: CGFloat) -> (x: Int, y: Int, width: Int, height: Int) {
    guard let data = context.data else { return (0, 0, 0, 0) }
    let pixels = data.bindMemory(to: UInt8.self, capacity: width * height)
    let backgroundByte = background > 0.5 ? 255 : 0
    var minX = width
    var minY = height
    var maxX = -1
    var maxY = -1
    for row in 0..<height {
        // Bitmap rows are stored bottom-up. The PNG's top row is the last buffer row.
        let bufferRow = height - 1 - row
        for column in 0..<width {
            let byte = pixels[bufferRow * width + column]
            if byte == backgroundByte { continue }
            minX = min(minX, column)
            minY = min(minY, row)
            maxX = max(maxX, column)
            maxY = max(maxY, row)
        }
    }
    if maxX < minX { return (0, 0, 0, 0) }
    return (minX, minY, maxX - minX + 1, maxY - minY + 1)
}
