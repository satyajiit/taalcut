// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreGraphics
import Foundation
import ImageIO

/// ImageIO still metadata. `contentIdentifier` is Apple maker note key 17, the
/// Live Photo pair id. A test cannot write that note; device-lab photos cover it.
func stillProperties(_ params: JSONValue, confinement: PathConfinement) -> WorkResponse {
    guard let path = params.object?["path"]?.string else {
        return .fail(.badRequest("missing path"))
    }
    switch confinement.resolve(path) {
    case .failure(let failure):
        return .fail(failure)
    case .success(let url):
        guard let body = readStill(url) else {
            return .fail(.failed("image.unreadable", "image could not be read", retryable: false))
        }
        return .ok(body)
    }
}

private func readStill(_ url: URL) -> JSONValue? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
        let width = intProperty(props, kCGImagePropertyPixelWidth),
        let height = intProperty(props, kCGImagePropertyPixelHeight),
        width > 0, height > 0
    else { return nil }
    let orientation = intProperty(props, kCGImagePropertyOrientation) ?? 1
    guard (1...8).contains(orientation) else { return nil }
    let exif = dictionary(props, kCGImagePropertyExifDictionary)
    let tiff = dictionary(props, kCGImagePropertyTIFFDictionary)
    let gps = dictionary(props, kCGImagePropertyGPSDictionary)
    var body: [String: JSONValue] = [
        "width": .number(Double(width)),
        "height": .number(Double(height)),
        "orientation": .number(Double(orientation)),
        "hasGainMap": .bool(hasGainMap(source)),
    ]
    if let time = stringProperty(exif, kCGImagePropertyExifDateTimeOriginal) {
        body["captureTime"] = .string(time)
    }
    if let offset = stringProperty(exif, kCGImagePropertyExifOffsetTimeOriginal)
        ?? stringProperty(exif, kCGImagePropertyExifOffsetTime)
    {
        body["offsetTime"] = .string(offset)
    }
    if let identifier = contentIdentifier(props) {
        body["contentIdentifier"] = .string(identifier)
    }
    if let point = gpsPoint(gps) {
        body["gps"] = point
    }
    if let make = stringProperty(tiff, kCGImagePropertyTIFFMake) {
        body["make"] = .string(make)
    }
    if let model = stringProperty(tiff, kCGImagePropertyTIFFModel) {
        body["model"] = .string(model)
    }
    return .object(body)
}

private func hasGainMap(_ source: CGImageSource) -> Bool {
    if CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeHDRGainMap) != nil {
        return true
    }
    if #available(macOS 15, *),
        CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeISOGainMap) != nil
    {
        return true
    }
    return false
}

/// Maker note key 17. ImageIO may surface the key as an int or a string.
private func contentIdentifier(_ props: [String: Any]) -> String? {
    guard let apple = props[kCGImagePropertyMakerAppleDictionary as String] as? [AnyHashable: Any] else {
        return nil
    }
    let raw = apple[17] ?? apple["17"] ?? apple[NSNumber(value: 17)]
    if let text = raw as? String, !text.isEmpty { return text }
    if let number = raw as? NSNumber { return number.stringValue }
    return nil
}

private func gpsPoint(_ gps: [String: Any]?) -> JSONValue? {
    guard let gps,
        let latitude = signed(
            numberProperty(gps, kCGImagePropertyGPSLatitude),
            ref: stringProperty(gps, kCGImagePropertyGPSLatitudeRef), negative: "S"),
        let longitude = signed(
            numberProperty(gps, kCGImagePropertyGPSLongitude),
            ref: stringProperty(gps, kCGImagePropertyGPSLongitudeRef), negative: "W")
    else { return nil }
    var body: [String: JSONValue] = [
        "latitude": .number(latitude),
        "longitude": .number(longitude),
    ]
    if let altitude = numberProperty(gps, kCGImagePropertyGPSAltitude) {
        let ref = stringProperty(gps, kCGImagePropertyGPSAltitudeRef)
        body["altitude"] = .number(ref == "1" ? -abs(altitude) : altitude)
    }
    return .object(body)
}

private func signed(_ value: Double?, ref: String?, negative: String) -> Double? {
    guard let value else { return nil }
    guard let ref else { return value }
    return ref.uppercased() == negative ? -abs(value) : abs(value)
}

private func dictionary(_ props: [String: Any], _ key: CFString) -> [String: Any]? {
    props[key as String] as? [String: Any]
}

private func stringProperty(_ props: [String: Any]?, _ key: CFString) -> String? {
    guard let props else { return nil }
    if let text = props[key as String] as? String, !text.isEmpty { return text }
    return nil
}

private func numberProperty(_ props: [String: Any], _ key: CFString) -> Double? {
    switch props[key as String] {
    case let number as Double: return number
    case let number as NSNumber: return number.doubleValue
    case let text as String: return rational(text)
    default: return nil
    }
}

private func rational(_ text: String) -> Double? {
    if let number = Double(text) { return number }
    let parts = text.split(separator: "/")
    guard parts.count == 2, let numerator = Double(parts[0]), let denominator = Double(parts[1]), denominator != 0
    else { return nil }
    return numerator / denominator
}
