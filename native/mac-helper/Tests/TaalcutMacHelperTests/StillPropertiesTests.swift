// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import TaalcutMacHelper

@Suite struct StillPropertiesTests {
    @Test func readsSizeOrientationTimeAndGps() throws {
        let root = FileManager.default.temporaryDirectory
        let url = try writeStill()
        defer { try? FileManager.default.removeItem(at: url) }
        let response = stillProperties(
            .object(["path": .string(url.path)]), confinement: PathConfinement(roots: [root.path]))
        let body = try #require(response.result)
        #expect(body.key("width")?.number == 640)
        #expect(body.key("height")?.number == 360)
        #expect(body.key("orientation")?.number == 6)
        #expect(body.key("captureTime")?.string == "2026:03:01 12:34:56")
        #expect(body.key("offsetTime")?.string == "+05:30")
        #expect(body.key("gps")?.key("latitude")?.number == 19.076)
        #expect(body.key("gps")?.key("longitude")?.number == 72.877)
        #expect(body.key("gps")?.key("altitude")?.number == 14.5)
        #expect(body.key("make")?.string == "Apple")
        #expect(body.key("model")?.string == "iPhone17,2")
        #expect(body.key("hasGainMap")?.bool == false)
        // Apple maker note key 17 cannot be written by CGImageDestination. contentIdentifier
        // stays absent here; device-lab Live Photos cover the pairing id.
        #expect(body.key("contentIdentifier") == nil)
    }

    @Test func refusesAPathOutsideTheRoot() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-still-root", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = try writeStill()
        defer { try? FileManager.default.removeItem(at: url) }
        let response = stillProperties(
            .object(["path": .string(url.path)]), confinement: PathConfinement(roots: [root.path]))
        #expect(response.failure?.code == "helper.path_not_allowed")
    }
}

private func writeStill() throws -> URL {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
        data: nil, width: 640, height: 360, bitsPerComponent: 8, bytesPerRow: 0,
        space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
        let image = context.makeImage()
    else { throw FixtureError.context }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-still-\(UUID().uuidString).jpg")
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { throw FixtureError.destination }
    let metadata: [CFString: Any] = [
        kCGImagePropertyOrientation: 6,
        kCGImagePropertyExifDictionary: [
            kCGImagePropertyExifDateTimeOriginal: "2026:03:01 12:34:56",
            kCGImagePropertyExifOffsetTimeOriginal: "+05:30",
        ],
        kCGImagePropertyGPSDictionary: [
            kCGImagePropertyGPSLatitude: 19.076,
            kCGImagePropertyGPSLatitudeRef: "N",
            kCGImagePropertyGPSLongitude: 72.877,
            kCGImagePropertyGPSLongitudeRef: "E",
            kCGImagePropertyGPSAltitude: 14.5,
            kCGImagePropertyGPSAltitudeRef: 0,
        ],
        kCGImagePropertyTIFFDictionary: [
            kCGImagePropertyTIFFMake: "Apple",
            kCGImagePropertyTIFFModel: "iPhone17,2",
        ],
    ]
    CGImageDestinationAddImage(destination, image, metadata as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw FixtureError.destination }
    return url
}
