// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct DrawnText: Sendable {
    var url: URL
    var text: String
    var box: CGRect
}

/// Renders one Latin (or Devanagari) line into a 1080×1920 PNG. The box is the
/// glyph bounds in Vision's lower-left normalised space.
func drawText(text: String, pointSize: CGFloat, lightOnDark: Bool, devanagari: Bool = false) throws -> DrawnText {
    let width = 1080
    let height = 1920
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { throw FixtureError.context }
    let background = lightOnDark
        ? CGColor(red: 0.06, green: 0.07, blue: 0.09, alpha: 1)
        : CGColor(gray: 0.96, alpha: 1)
    let foreground = lightOnDark ? CGColor(gray: 1, alpha: 1) : CGColor(gray: 0.08, alpha: 1)
    context.setFillColor(background)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let fontName = devanagari ? "KohinoorDevanagari-Regular" : "Helvetica"
    let font = CTFontCreateWithName(fontName as CFString, pointSize, nil)
    let attributes = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: foreground] as CFDictionary
    let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, text as CFString, attributes))
    context.textPosition = CGPoint(x: 80, y: 900)
    let bounds = CTLineGetImageBounds(line, context)
    CTLineDraw(line, context)
    guard let image = context.makeImage() else { throw FixtureError.context }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-ocr-\(UUID().uuidString).png")
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { throw FixtureError.destination }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw FixtureError.destination }
    let box = CGRect(
        x: bounds.minX / CGFloat(width), y: bounds.minY / CGFloat(height),
        width: bounds.width / CGFloat(width), height: bounds.height / CGFloat(height))
    return DrawnText(url: url, text: text, box: box)
}

enum FixtureError: Error {
    case context
    case destination
}
