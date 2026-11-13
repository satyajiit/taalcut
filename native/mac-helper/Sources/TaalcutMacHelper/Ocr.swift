// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreGraphics
import Foundation
import ImageIO
import Vision

struct OcrObservation: Sendable {
    var text: String
    var confidence: Double
    var language: String?
    var box: CGRect
    /// FIX-SIGN: the text's corners (top left, top right, bottom right, bottom left of the words as they read), in
    /// the box's space: a level rectangle for flat on-screen text, off level or out of square for a sign at an angle.
    var quad: [CGPoint]? = nil
}

/// What Vision reads: a frame file the client wrote, or an image drawn here (the warm-up's canvases, OcrWarmup.swift).
enum OcrInput: @unchecked Sendable {
    case file(URL)
    case image(CGImage)
}

/// Apple Vision text recognition. Boxes stay in Vision's normalised lower-left
/// space; the vision client flips them. `forceLegacy` selects
/// `VNRecognizeTextRequest` on macOS 15+ (the `--force-legacy-ocr` test flag).
struct OcrEngine: Sendable {
    var forceLegacy: Bool

    init(forceLegacy: Bool = false) {
        self.forceLegacy = forceLegacy
    }

    var usesModernAPI: Bool {
        if forceLegacy { return false }
        if #available(macOS 15, *) { return true }
        return false
    }

    var apiName: String {
        usesModernAPI ? "RecognizeTextRequest" : "VNRecognizeTextRequest"
    }

    func languages() -> WorkResponse {
        .ok(.object([
            "api": .string(apiName),
            "revision": .number(Double(BuildStamp.ocrRevision)),
            "accurate": .array(supportedIdentifiers(fast: false).map { .string($0) }),
            "fast": .array(supportedIdentifiers(fast: true).map { .string($0) }),
        ]))
    }

    func supportedIdentifiers(fast: Bool) -> [String] {
        if usesModernAPI {
            if #available(macOS 15, *) {
                return modernIdentifiers(fast: fast)
            }
        }
        return legacyIdentifiers(fast: fast)
    }

    /// `progress`: the share of the images read so far, after each one (the keepalive lines carry it).
    func recognize(
        _ params: JSONValue, confinement: PathConfinement, progress: @Sendable (Double) -> Void = { _ in }
    ) async -> WorkResponse {
        guard let object = params.object else {
            return .fail(.badRequest("params must be an object"))
        }
        guard let paths = stringList(object["paths"]), (1...16).contains(paths.count) else {
            return .fail(.badRequest("paths must contain 1 to 16 images"))
        }
        let requested = stringList(object["languages"]) ?? []
        if object["languages"] != nil && stringList(object["languages"]) == nil {
            return .fail(.badRequest("languages must be an array of strings"))
        }
        guard let fast = levelIsFast(object["level"]) else {
            return .fail(.badRequest("level must be accurate or fast"))
        }
        guard let correction = boolParam(object, "languageCorrection", default: true) else {
            return .fail(.badRequest("languageCorrection must be a boolean"))
        }
        guard let autoDetect = boolParam(object, "autoDetectLanguage", default: true) else {
            return .fail(.badRequest("autoDetectLanguage must be a boolean"))
        }
        guard let minimum = heightParam(object["minimumTextHeight"]) else {
            return .fail(.badRequest("minimumTextHeight must be between 0 and 1"))
        }
        let words: [String]
        if let custom = object["customWords"] {
            guard let parsed = stringList(custom) else {
                return .fail(.badRequest("customWords must be an array of strings"))
            }
            guard parsed.count <= 200 else {
                return .fail(.badRequest("customWords must contain at most 200 strings"))
            }
            words = parsed
        } else {
            words = []
        }
        let supported = supportedIdentifiers(fast: fast)
        let languages: [String]
        switch resolveLanguages(requested, supported: supported) {
        case .success(let matched):
            languages = matched
        case .failure(let failure):
            return .fail(failure)
        }
        let appliedWords = correction ? words : []
        var images: [JSONValue] = []
        for path in paths {
            switch confinement.resolve(path) {
            case .failure(let failure):
                return .fail(failure)
            case .success(let url):
                guard let size = pixelSize(url) else {
                    return .fail(.failed("ocr.image_unreadable", "image could not be read", retryable: false))
                }
                let started = Date()
                let observations: [OcrObservation]
                do {
                    observations = try await readObservations(
                        .file(url), fast: fast, correction: correction, autoDetect: autoDetect,
                        languages: languages, minimum: minimum, words: appliedWords)
                } catch {
                    return .fail(.failed("ocr.failed", "text recognition failed", retryable: true))
                }
                let ms = Int(Date().timeIntervalSince(started) * 1000)
                images.append(imageJSON(path: path, size: size, ms: ms, observations: observations))
                progress(Double(images.count) / Double(paths.count))
            }
        }
        return .ok(.object([
            "api": .string(apiName),
            "revision": .number(Double(BuildStamp.ocrRevision)),
            "boxSpace": .string("normalized-lower-left"),
            "images": .array(images),
        ]))
    }

    /// Reads an image drawn here as the client reads by default (accurate, corrected, languages detected, Vision's
    /// minimum text height): the warm-up. The number of lines read, or why not.
    func warm(_ image: CGImage, languages requested: [String]) async -> Result<Int, HelperFailure> {
        let languages: [String]
        switch resolveLanguages(requested, supported: supportedIdentifiers(fast: false)) {
        case .success(let matched): languages = matched
        case .failure(let failure): return .failure(failure)
        }
        do {
            let observations = try await readObservations(
                .image(image), fast: false, correction: true, autoDetect: true,
                languages: languages, minimum: 1.0 / 32, words: [])
            return .success(observations.count)
        } catch {
            return .failure(.failed("ocr.failed", "text recognition failed", retryable: true))
        }
    }

    private func readObservations(
        _ input: OcrInput, fast: Bool, correction: Bool, autoDetect: Bool, languages: [String],
        minimum: Double, words: [String]
    ) async throws -> [OcrObservation] {
        if usesModernAPI {
            if #available(macOS 15, *) {
                return try await modernObservations(
                    input, fast: fast, correction: correction, autoDetect: autoDetect,
                    languages: languages, minimum: minimum, words: words)
            }
        }
        return try await legacyObservations(
            input, fast: fast, correction: correction, autoDetect: autoDetect,
            languages: languages, minimum: minimum, words: words)
    }
}

@available(macOS 15, *)
private func modernIdentifiers(fast: Bool) -> [String] {
    var request = RecognizeTextRequest(.revision3)
    request.recognitionLevel = fast ? .fast : .accurate
    return request.supportedRecognitionLanguages.map(\.minimalIdentifier)
}

private func legacyIdentifiers(fast: Bool) -> [String] {
    let request = VNRecognizeTextRequest()
    request.revision = VNRecognizeTextRequestRevision3
    request.recognitionLevel = fast ? .fast : .accurate
    return (try? request.supportedRecognitionLanguages()) ?? []
}

@available(macOS 15, *)
private func modernObservations(
    _ input: OcrInput, fast: Bool, correction: Bool, autoDetect: Bool, languages: [String],
    minimum: Double, words: [String]
) async throws -> [OcrObservation] {
    var request = RecognizeTextRequest(.revision3)
    request.recognitionLevel = fast ? .fast : .accurate
    request.usesLanguageCorrection = correction
    request.automaticallyDetectsLanguage = autoDetect
    request.recognitionLanguages = languages.map { Locale.Language(identifier: $0) }
    request.minimumTextHeightFraction = Float(minimum)
    request.customWords = words
    let observations: [RecognizedTextObservation]
    switch input {
    case .file(let url): observations = try await request.perform(on: url)
    case .image(let image): observations = try await request.perform(on: image)
    }
    return observations.compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox.cgRect
        let corners = [observation.topLeft, observation.topRight, observation.bottomRight, observation.bottomLeft]
        return OcrObservation(
            text: candidate.string, confidence: Double(candidate.confidence),
            language: modernLanguage(observation), box: box,
            quad: corners.map { CGPoint(x: $0.x, y: $0.y) })
    }
}

@available(macOS 15, *)
private func modernLanguage(_ observation: RecognizedTextObservation) -> String? {
    if #available(macOS 26, *) {
        return observation.recognitionLanguages.first?.minimalIdentifier
    }
    return nil
}

@concurrent
private func legacyObservations(
    _ input: OcrInput, fast: Bool, correction: Bool, autoDetect: Bool, languages: [String],
    minimum: Double, words: [String]
) async throws -> [OcrObservation] {
    let request = VNRecognizeTextRequest()
    request.revision = VNRecognizeTextRequestRevision3
    request.recognitionLevel = fast ? .fast : .accurate
    request.usesLanguageCorrection = correction
    request.automaticallyDetectsLanguage = autoDetect
    request.recognitionLanguages = languages
    request.minimumTextHeight = Float(minimum)
    request.customWords = words
    let handler: VNImageRequestHandler
    switch input {
    case .file(let url): handler = VNImageRequestHandler(url: url, options: [:])
    case .image(let image): handler = VNImageRequestHandler(cgImage: image, options: [:])
    }
    try handler.perform([request])
    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return OcrObservation(
            text: candidate.string, confidence: Double(candidate.confidence),
            language: nil, box: observation.boundingBox,
            quad: [observation.topLeft, observation.topRight, observation.bottomRight, observation.bottomLeft])
    }
}

private func resolveLanguages(_ requested: [String], supported: [String]) -> Result<[String], HelperFailure> {
    let wanted = requested.isEmpty ? ["en", "es", "pt"] : requested
    var matched: [String] = []
    for language in wanted {
        guard let hit = matchLanguage(language, supported: supported) else {
            return .failure(.languageUnsupported(language, supported: supported))
        }
        matched.append(hit)
    }
    return .success(matched)
}

private func matchLanguage(_ requested: String, supported: [String]) -> String? {
    let want = requested.lowercased()
    if let exact = supported.first(where: { $0.lowercased() == want }) { return exact }
    if want == "pt", let brazilian = supported.first(where: { $0.lowercased() == "pt-br" }) {
        return brazilian
    }
    if let prefixed = supported.first(where: { $0.lowercased().hasPrefix(want + "-") }) {
        return prefixed
    }
    return supported.first { want.hasPrefix($0.lowercased() + "-") }
}

private func pixelSize(_ url: URL) -> (Int, Int)? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
        let width = intProperty(props, kCGImagePropertyPixelWidth),
        let height = intProperty(props, kCGImagePropertyPixelHeight),
        width > 0, height > 0
    else { return nil }
    return (width, height)
}

private func imageJSON(path: String, size: (Int, Int), ms: Int, observations: [OcrObservation]) -> JSONValue {
    .object([
        "path": .string(path),
        "width": .number(Double(size.0)),
        "height": .number(Double(size.1)),
        "ms": .number(Double(ms)),
        "observations": .array(observations.map { observation in
            var body: [String: JSONValue] = [
                "text": .string(observation.text),
                "confidence": .number(observation.confidence),
                "box": .object([
                    "x": .number(observation.box.origin.x),
                    "y": .number(observation.box.origin.y),
                    "width": .number(observation.box.width),
                    "height": .number(observation.box.height),
                ]),
            ]
            if let language = observation.language { body["language"] = .string(language) }
            if let quad = observation.quad, quad.count == 4 {
                body["quad"] = .array(quad.map { .object(["x": .number($0.x), "y": .number($0.y)]) })
            }
            return .object(body)
        }),
    ])
}

private func stringList(_ value: JSONValue?) -> [String]? {
    guard let value else { return nil }
    guard let array = value.array else { return nil }
    var strings: [String] = []
    for item in array {
        guard let string = item.string else { return nil }
        strings.append(string)
    }
    return strings
}

private func boolParam(_ object: [String: JSONValue], _ key: String, default fallback: Bool) -> Bool? {
    guard let value = object[key] else { return fallback }
    return value.bool
}

private func levelIsFast(_ value: JSONValue?) -> Bool? {
    guard let value else { return false }
    switch value.string {
    case "accurate": return false
    case "fast": return true
    default: return nil
    }
}

private func heightParam(_ value: JSONValue?) -> Double? {
    guard let value else { return 0.03125 }
    guard let number = value.number, number.isFinite, number >= 0, number <= 1 else { return nil }
    return number
}

func intProperty(_ props: [String: Any], _ key: CFString) -> Int? {
    switch props[key as String] {
    case let number as Int: return number
    case let number as NSNumber: return number.intValue
    default: return nil
    }
}
