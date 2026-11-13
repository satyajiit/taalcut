// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreGraphics
import CoreText
import Foundation

/// One line of a warm-up canvas.
struct WarmLine: Sendable {
    var font: String
    var text: String
}

/// One warm-up read: a canvas with lines in one script family, read with that family's languages.
struct WarmStep: Sendable {
    var script: String
    var languages: [String]
    var lines: [WarmLine]
}

/// One step per script family this OS lists, the main one first. Measured on macOS 27.2 (FIX-OCRCOLD): a new helper
/// build compiles Vision's detector and main recogniser on its first read, then the Arabic and the Devanagari
/// recognisers on the first line in their script, whatever languages the request names; Cyrillic, Chinese, Japanese,
/// Korean and Thai share the main one. The image's size, the minimum text height and the language list compile
/// nothing (64×64 to 8000×4500 px were all warm), so the kinds of request are these models, and these steps cover
/// them. The families with no model of their own on 27.2 cost a warm read each (about 0.2 s): another macOS may split
/// them.
func warmSteps(supported: [String]) -> [WarmStep] {
    let bases = Set(supported.map { String($0.lowercased().split(separator: "-").first ?? "") })
    var steps = [WarmStep(
        script: "latin", languages: ["en", "es", "pt"], lines: [WarmLine(font: "Helvetica", text: "Taalcut warm up 2026")])]
    if let devanagari = ["hi", "mr"].first(where: bases.contains) {
        steps.append(WarmStep(
            script: "devanagari", languages: [devanagari],
            lines: [WarmLine(font: "KohinoorDevanagari-Regular", text: "नमस्ते दुनिया")]))
    }
    if let arabic = ["ar", "ars"].first(where: bases.contains) {
        steps.append(WarmStep(
            script: "arabic", languages: [arabic], lines: [WarmLine(font: "GeezaPro", text: "مرحبا بالعالم")]))
    }
    let cjk: [(String, WarmLine)] = [
        ("zh", WarmLine(font: "PingFangSC-Regular", text: "欢迎光临")),
        ("ja", WarmLine(font: "HiraginoSans-W3", text: "ようこそ")),
        ("ko", WarmLine(font: "AppleSDGothicNeo-Regular", text: "환영합니다")),
    ].filter { bases.contains($0.0) }
    if !cjk.isEmpty {
        steps.append(WarmStep(script: "cjk", languages: cjk.map(\.0), lines: cjk.map(\.1)))
    }
    if let cyrillic = ["ru", "uk"].first(where: bases.contains) {
        steps.append(WarmStep(
            script: "cyrillic", languages: [cyrillic], lines: [WarmLine(font: "Helvetica", text: "Добро пожаловать")]))
    }
    if bases.contains("th") {
        steps.append(WarmStep(
            script: "thai", languages: ["th"], lines: [WarmLine(font: "Thonburi", text: "ยินดีต้อนรับ")]))
    }
    return steps
}

/// A 1280×720 canvas, light text on dark, one line per 140 px from the top.
func warmCanvas(_ step: WarmStep) -> CGImage? {
    let width = 1280
    let height = 720
    guard let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    context.setFillColor(CGColor(red: 0.06, green: 0.07, blue: 0.09, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    for (index, line) in step.lines.enumerated() {
        let font = CTFontCreateWithName(line.font as CFString, 72, nil)
        let attributes = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: CGColor(gray: 1, alpha: 1)]
            as CFDictionary
        let drawn = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, line.text as CFString, attributes))
        context.textPosition = CGPoint(x: 96, y: CGFloat(height - 160 - index * 140))
        CTLineDraw(drawn, context)
    }
    return context.makeImage()
}

/// The OCR warm-up (OCR v2, FIX-OCRCOLD). From the process's start, at utility priority, it reads one canvas per
/// step so Vision compiles its models before a person's breakdown needs them; once a build has compiled them, every
/// process of that build reads them warm (a step then takes about 0.2 s).
///
/// A real read never waits behind it longer than its own compile would take: a step starts only while no real read is
/// in flight or queued, and a read that arrives during the first step (the detector and the main recogniser, which
/// every read needs) waits for that step rather than compile the same models beside it. Later steps never hold a read.
/// The warm-up takes no OCR slot, and the process doesn't exit idle while it runs.
actor OcrWarmup {
    typealias Reader = @Sendable (WarmStep) async -> Result<Int, HelperFailure>

    private let read: Reader
    private let steps: [WarmStep]
    private var reads = 0
    private var baseRunning = false
    private var finished = false
    private var task: Task<Void, Never>?
    private var startedAt: ContinuousClock.Instant?
    private var finishedAt: ContinuousClock.Instant?
    private var yielded: Duration = .zero
    private var results: [JSONValue] = []
    private var idleWaiters: [CheckedContinuation<Void, Never>] = []
    private var baseWaiters: [CheckedContinuation<Void, Never>] = []
    private var doneWaiters: [CheckedContinuation<Void, Never>] = []

    /// `child`: this build's executable, which reads each step in a process of its own (WarmChild.swift), so its
    /// compiles don't hold this process's reads; without one, the steps are read here.
    init(engine: OcrEngine, child: URL? = nil, forceLegacy: Bool = false) {
        let steps = warmSteps(supported: engine.supportedIdentifiers(fast: false))
        if let child {
            self.init(steps: steps, read: WarmChild.reader(executable: child, forceLegacy: forceLegacy))
            return
        }
        self.init(steps: steps) { step in
            guard let canvas = warmCanvas(step) else {
                return .failure(.failed("ocr.failed", "warm-up canvas could not be drawn", retryable: false))
            }
            return await engine.warm(canvas, languages: step.languages)
        }
    }

    /// `read`: how a step is read (a test's stand-in; the engine's warm read otherwise).
    init(steps: [WarmStep], read: @escaping Reader) {
        self.steps = steps
        self.read = read
    }

    var scripts: [String] { steps.map(\.script) }

    /// Running or about to: the serve loop doesn't exit idle meanwhile (an exit would lose the compile).
    var running: Bool { task != nil && !finished }

    func start() {
        guard task == nil else { return }
        startedAt = .now
        task = Task.detached(priority: .utility) { [weak self] in
            await self?.runSteps()
        }
    }

    func stop() {
        task?.cancel()
        wake(&idleWaiters)
    }

    /// A real `ocr.recognize` arrived (before its slot) or was answered.
    func readArrived() { reads += 1 }

    func readFinished() {
        reads = max(0, reads - 1)
        if reads == 0 { wake(&idleWaiters) }
    }

    /// Called by a real read once it has its slot: waits while the first step compiles the models every read needs.
    func beforeRead() async {
        while baseRunning {
            await withCheckedContinuation { baseWaiters.append($0) }
        }
    }

    /// `ocr.warmup`'s answer, once every step has run: `{ steps: [{ script, languages, ms, lines | error }], ms,
    /// yieldedMs }`.
    func report() async -> JSONValue {
        if task != nil, !finished {
            await withCheckedContinuation { doneWaiters.append($0) }
        }
        let total = (finishedAt ?? .now) - (startedAt ?? .now)
        return .object([
            "steps": .array(results),
            "ms": .number(Double(milliseconds(total))),
            "yieldedMs": .number(Double(milliseconds(yielded))),
        ])
    }

    private func runSteps() async {
        for (index, step) in steps.enumerated() {
            let waited = ContinuousClock.now
            while reads > 0, !Task.isCancelled {
                await withCheckedContinuation { idleWaiters.append($0) }
            }
            yielded += ContinuousClock.now - waited
            if Task.isCancelled { break }
            baseRunning = index == 0
            let began = ContinuousClock.now
            let outcome = await read(step)
            var body: [String: JSONValue] = [
                "script": .string(step.script),
                "languages": .array(step.languages.map { .string($0) }),
                "ms": .number(Double(milliseconds(ContinuousClock.now - began))),
            ]
            switch outcome {
            case .success(let lines): body["lines"] = .number(Double(lines))
            case .failure(let failure): body["error"] = .string(failure.code)
            }
            results.append(.object(body))
            if baseRunning {
                baseRunning = false
                wake(&baseWaiters)
            }
        }
        baseRunning = false
        finished = true
        finishedAt = .now
        wake(&baseWaiters)
        wake(&doneWaiters)
    }

    private func wake(_ waiters: inout [CheckedContinuation<Void, Never>]) {
        let woken = waiters
        waiters.removeAll()
        for waiter in woken { waiter.resume() }
    }
}

private func milliseconds(_ duration: Duration) -> Int {
    let (seconds, attoseconds) = duration.components
    return Int(seconds) * 1000 + Int(attoseconds / 1_000_000_000_000_000)
}
