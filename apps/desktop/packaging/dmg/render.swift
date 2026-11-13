// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Run from the repository root: swift apps/desktop/packaging/dmg/render.swift
// Finder uses point coordinates. The TIFF contains 1x and 2x representations.
import AppKit

let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let image = NSImage(size: NSSize(width: 660, height: 440))
var representations: [NSBitmapImageRep] = []

for scale in [1, 2] {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: 660 * scale, pixelsHigh: 440 * scale,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    rep.size = image.size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor(red: 0.98, green: 0.97, blue: 0.94, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: 660, height: 440).fill()

    let centered = NSMutableParagraphStyle()
    centered.alignment = .center
    let ink = NSColor(red: 0.13, green: 0.14, blue: 0.13, alpha: 1)
    let muted = NSColor(red: 0.37, green: 0.39, blue: 0.37, alpha: 1)
    let title: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 34, weight: .semibold),
        .foregroundColor: ink, .paragraphStyle: centered,
    ]
    let caption: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 15),
        .foregroundColor: muted, .paragraphStyle: centered,
    ]
    ("Make room for your next reel." as NSString).draw(
        in: NSRect(x: 20, y: 334, width: 620, height: 48), withAttributes: title)
    ("Drag Taalcut into Applications to install." as NSString).draw(
        in: NSRect(x: 20, y: 298, width: 620, height: 30), withAttributes: caption)
    ("Then open Taalcut from Applications." as NSString).draw(
        in: NSRect(x: 20, y: 54, width: 620, height: 24), withAttributes: caption)

    // The real Finder icons sit at (180, 240) and (480, 240), measured from the top.
    let arrow = NSBezierPath()
    arrow.move(to: NSPoint(x: 300, y: 200))
    arrow.line(to: NSPoint(x: 360, y: 200))
    arrow.move(to: NSPoint(x: 348, y: 212))
    arrow.line(to: NSPoint(x: 360, y: 200))
    arrow.line(to: NSPoint(x: 348, y: 188))
    arrow.lineWidth = 3
    arrow.lineCapStyle = .round
    arrow.lineJoinStyle = .round
    NSColor(red: 0.72, green: 0.43, blue: 0.08, alpha: 1).setStroke()
    arrow.stroke()
    NSGraphicsContext.restoreGraphicsState()
    representations.append(rep)
}

// NSImage.tiffRepresentation puts the 2x representation first. electron-builder 26 reads the first
// TIFF image's pixel size with sips and ignores dmg.window when a background exists. Keep 1x first
// so its Finder window uses points, while AppKit can still choose the 2x representation on Retina.
let tiff = NSBitmapImageRep.representationOfImageReps(in: representations, using: .tiff, properties: [:])!
let decoded = NSBitmapImageRep.imageReps(with: tiff)
precondition(decoded.map { $0.pixelsWide } == [660, 1320])
precondition(decoded.map { $0.pixelsHigh } == [440, 880])
precondition(decoded.allSatisfy { $0.size == image.size })
try tiff.write(to: directory.appendingPathComponent("background.tiff"))
