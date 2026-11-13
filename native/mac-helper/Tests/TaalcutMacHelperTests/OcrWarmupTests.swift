// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

/// The warm-up's rule (FIX-OCRCOLD) with a stand-in reader: a real read never waits behind it longer than its own
/// compile would take. Vision itself reads the canvases in `OcrTests.warmUpCanvasesAreRead`.
@Suite struct OcrWarmupTests {
    /// macOS 27.2's list, as its ready line gives it.
    private let macOS27 = [
        "en", "fr", "it", "de", "es", "pt", "zh", "zh-TW", "yue-CN", "yue", "ko", "ja", "ru", "uk", "th", "vi-VT",
        "ar-SA", "ars", "tr", "id", "cs", "da", "nl", "no", "nn", "nb", "ms", "pl", "ro", "sv", "fi", "hi", "mr",
    ]

    @Test func stepsFollowTheSupportedList() {
        #expect(warmSteps(supported: macOS27).map(\.script) == [
            "latin", "devanagari", "arabic", "cjk", "cyrillic", "thai",
        ])
        let older = macOS27.filter { !["hi", "mr"].contains($0) }
        #expect(warmSteps(supported: older).map(\.script).contains("devanagari") == false)
        #expect(warmSteps(supported: ["en", "fr", "es", "pt"]).map(\.script) == ["latin"])
        let deva = warmSteps(supported: ["en", "es", "pt", "mr"])[1]
        #expect(deva.languages == ["mr"])
        #expect(warmSteps(supported: macOS27)[3].languages == ["zh", "ja", "ko"])
    }

    @Test func canvasesAreDrawn() throws {
        for step in warmSteps(supported: macOS27) {
            let canvas = try #require(warmCanvas(step))
            #expect(canvas.width == 1280 && canvas.height == 720)
        }
    }

    @Test func aStepWaitsWhileARealReadIsInFlightOrQueued() async {
        let reader = Reader()
        let warmup = OcrWarmup(steps: steps(["latin", "devanagari"]), read: reader.read)
        await warmup.readArrived()
        await warmup.start()
        try? await Task.sleep(for: .milliseconds(80))
        #expect(await reader.started.isEmpty)
        #expect(await warmup.running)
        await warmup.readFinished()
        await reader.waitForStart("latin")
        await reader.release("latin")
        await reader.waitForStart("devanagari")
        await reader.release("devanagari")
        let report = await warmup.report()
        #expect(report.key("steps")?.array?.compactMap { $0.key("script")?.string } == ["latin", "devanagari"])
        #expect((report.key("yieldedMs")?.number ?? 0) >= 50)
        #expect(await warmup.running == false)
    }

    @Test func aReadDuringTheFirstStepWaitsForIt() async {
        let reader = Reader()
        let warmup = OcrWarmup(steps: steps(["latin", "devanagari"]), read: reader.read)
        await warmup.start()
        await reader.waitForStart("latin")
        let read = Task {
            await warmup.beforeRead()
            return ContinuousClock.now
        }
        try? await Task.sleep(for: .milliseconds(80))
        let released = ContinuousClock.now
        await reader.release("latin")
        let readStarted = await read.value
        #expect(readStarted >= released)
        await reader.waitForStart("devanagari")
        await reader.release("devanagari")
        _ = await warmup.report()
    }

    @Test func aReadDuringALaterStepGoesAhead() async {
        let reader = Reader()
        let warmup = OcrWarmup(steps: steps(["latin", "devanagari"]), read: reader.read)
        await warmup.start()
        await reader.waitForStart("latin")
        await reader.release("latin")
        await reader.waitForStart("devanagari")
        let read = Task { await warmup.beforeRead() }
        let deadline = ContinuousClock.now + .seconds(1)
        // beforeRead returns while the Devanagari step is still held.
        await read.value
        #expect(ContinuousClock.now < deadline)
        await reader.release("devanagari")
        _ = await warmup.report()
    }

    @Test func failuresAreReportedAndStopEndsIt() async {
        let failing = OcrWarmup(steps: steps(["latin"])) { _ in
            .failure(.failed("ocr.failed", "no", retryable: true))
        }
        await failing.start()
        let report = await failing.report()
        #expect(report.key("steps")?.array?.first?.key("error")?.string == "ocr.failed")

        let reader = Reader()
        let stopped = OcrWarmup(steps: steps(["latin", "devanagari"]), read: reader.read)
        await stopped.readArrived()
        await stopped.start()
        await stopped.stop()
        let empty = await stopped.report()
        #expect(empty.key("steps")?.array?.isEmpty == true)
        #expect(await stopped.running == false)

        let never = OcrWarmup(steps: steps(["latin"])) { _ in .success(1) }
        #expect(await never.report().key("steps")?.array?.isEmpty == true)
    }

    private func steps(_ scripts: [String]) -> [WarmStep] {
        scripts.map { WarmStep(script: $0, languages: ["en"], lines: [WarmLine(font: "Helvetica", text: $0)]) }
    }
}

/// A stand-in reader whose steps finish when the test releases them.
private actor Reader {
    private(set) var started: [String] = []
    private var released: Set<String> = []

    nonisolated var read: OcrWarmup.Reader {
        { step in await self.run(step) }
    }

    private func run(_ step: WarmStep) async -> Result<Int, HelperFailure> {
        started.append(step.script)
        while !released.contains(step.script) {
            try? await Task.sleep(for: .milliseconds(5))
        }
        return .success(1)
    }

    func release(_ script: String) { released.insert(script) }

    func waitForStart(_ script: String) async {
        let deadline = ContinuousClock.now + .seconds(5)
        while !started.contains(script), ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(5))
        }
    }
}
