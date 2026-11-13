// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Renders the OCR fixture lines in this folder: one cropped text line per PNG
// (8-bit gray, a few KB), Latin in the system font and Devanagari in Noto Sans
// Devanagari (SIL OFL 1.1, see OFL-NOTE.md), with Core Text. The LGPL FFmpeg
// has no drawtext, so lines are rendered once here and committed; tests paint
// them onto synthetic frames. Regenerate (only when the line list changes):
//   swift test/fixtures/text/render.swift <NotoSansDevanagari-Regular.ttf> test/fixtures/text
// Adapted from spike 05's renderer (.spikes/05-vision-ocr/render.swift).

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Line {
    let id: String
    let text: String
    let language: String
    let darkBox: Bool
}

let lines: [Line] = [
    Line(id: "latin-en", text: "Save 20% today", language: "en", darkBox: true),
    Line(id: "latin-es", text: "Suscríbete al canal", language: "es", darkBox: false),
    Line(id: "latin-pt", text: "Não perca essa oferta", language: "pt", darkBox: true),
    Line(id: "deva-namaste", text: "नमस्ते दोस्तों", language: "hi", darkBox: true),
    Line(id: "deva-abhi", text: "अभी खरीदें", language: "hi", darkBox: false),
    Line(id: "deva-price", text: "कीमत केवल ₹499", language: "hi", darkBox: true),
    Line(id: "deva-suprabhat", text: "सुप्रभात भारत", language: "hi", darkBox: false),
]

let pointSize: CGFloat = 44
let padding: CGFloat = 18

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
guard args.count == 3 else { fail("usage: render.swift <NotoSansDevanagari-Regular.ttf> <out-dir>") }
guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(URL(fileURLWithPath: args[1]) as CFURL)
    as? [CTFontDescriptor], let noto = descriptors.first
else { fail("no font in \(args[1])") }
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)

// Noto Sans Devanagari has no Latin glyphs: cascade to Helvetica Neue for them.
let latin = CTFontDescriptorCreateWithAttributes([kCTFontNameAttribute: "Helvetica Neue"] as CFDictionary)
let cascaded = CTFontDescriptorCreateCopyWithAttributes(
    noto, [kCTFontCascadeListAttribute: [latin] as CFArray] as CFDictionary)
let devanagariFont = CTFontCreateWithFontDescriptor(cascaded, pointSize, nil)
let latinFont = CTFontCreateWithName("Helvetica Neue" as CFString, pointSize, nil)

var manifest: [[String: Any]] = []
for line in lines {
    let font = line.language == "hi" ? devanagariFont : latinFont
    let ink = CGColor(gray: line.darkBox ? 1 : 0, alpha: 1)
    let attributed = NSAttributedString(
        string: line.text.precomposedStringWithCanonicalMapping,
        attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): ink,
            NSAttributedString.Key(kCTLanguageAttributeName as String): line.language,
        ])
    let ctLine = CTLineCreateWithAttributedString(attributed)
    var ascent: CGFloat = 0
    var descent: CGFloat = 0
    var leading: CGFloat = 0
    let width = CGFloat(CTLineGetTypographicBounds(ctLine, &ascent, &descent, &leading))
    let w = Int((width + padding * 2).rounded(.up))
    let h = Int((ascent + descent + padding * 2).rounded(.up))
    guard let ctx = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
    else { fail("context") }
    ctx.setFillColor(CGColor(gray: line.darkBox ? 17.0 / 255 : 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.setShouldAntialias(true)
    ctx.textPosition = CGPoint(x: padding, y: padding + descent)
    CTLineDraw(ctLine, ctx)
    guard let image = ctx.makeImage() else { fail("image") }
    let url = outDir.appendingPathComponent("\(line.id).png")
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { fail("destination") }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fail("write \(url.path)") }
    manifest.append([
        "file": "\(line.id).png", "text": line.text.precomposedStringWithCanonicalMapping,
        "language": line.language, "width": w, "height": h,
    ])
}
let json = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
try json.write(to: outDir.appendingPathComponent("lines.json"))
print("wrote \(manifest.count) lines to \(outDir.path)")
