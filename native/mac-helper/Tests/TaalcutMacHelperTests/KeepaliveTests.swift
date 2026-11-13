// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

/// OCR v2 (FIX-OCRCOLD): every OCR request says it is alive until its answer, so the client never cancels a compile.
@Suite struct KeepaliveTests {
    private func session(
        started: Set<HelperService>, inbox: Inbox, latch: Latch, hold: Set<String>, hooks: WorkHooks = .none
    ) -> ProtocolSession {
        ProtocolSession(
            started: started,
            handler: { method, _, _, _ in
                if hold.contains(method) { await latch.waitUntilOpen() }
                return .ok(.object(["method": .string(method)]))
            },
            sink: { inbox.append($0) }, keepaliveSeconds: 0.03, hooks: hooks)
    }

    private func beats(_ inbox: Inbox, _ id: String) -> [JSONValue] {
        inbox.snapshot().map(\.json).filter {
            $0.key("type")?.string == "progress" && $0.key("id")?.string == id
        }
    }

    @Test func queuedAndRunningOcrRequestsBeatUntilAnswered() async {
        let inbox = Inbox()
        let latch = Latch()
        let live = session(started: [.ocr], inbox: inbox, latch: latch, hold: ["ocr.recognize"])
        // Two slots: the third read waits for one.
        for id in ["a", "b", "c"] { await live.accept(request(id, "ocr.recognize")) }
        try? await Task.sleep(for: .milliseconds(250))
        #expect(beats(inbox, "a").count >= 3)
        #expect(beats(inbox, "a").last?.key("stage")?.string == "running")
        #expect(beats(inbox, "c").last?.key("stage")?.string == "queued")
        #expect(beats(inbox, "c").last?.key("fraction")?.number == 0)
        await latch.open()
        for id in ["a", "b", "c"] { #expect(await waitForResponse(inbox, id)) }
        try? await Task.sleep(for: .milliseconds(60))
        let settled = inbox.snapshot().count
        try? await Task.sleep(for: .milliseconds(150))
        // Answered: no more beats for any of them.
        #expect(inbox.snapshot().count == settled)
        let answers = inbox.snapshot().map(\.json).filter { $0.key("type")?.string == "response" }
        #expect(Set(answers.compactMap { $0.key("id")?.string }) == ["a", "b", "c"])
    }

    @Test func speechKeepsItsOwnProgressOnly() async {
        let inbox = Inbox()
        let latch = Latch()
        let live = session(started: [.asr], inbox: inbox, latch: latch, hold: ["asr.load"])
        await live.accept(request("load", "asr.load"))
        try? await Task.sleep(for: .milliseconds(150))
        #expect(beats(inbox, "load").isEmpty)
        await latch.open()
        _ = await inbox.waitFor(1)
    }

    @Test func warmupTakesNoSlotAndHooksSeeEachRequest() async {
        let inbox = Inbox()
        let latch = Latch()
        let seen = Seen()
        let hooks = WorkHooks(
            arrived: { await seen.add("+\($0)") }, finished: { await seen.add("-\($0)") })
        let live = session(
            started: [.ocr], inbox: inbox, latch: latch, hold: ["ocr.recognize"], hooks: hooks)
        await live.accept(request("a", "ocr.recognize"))
        await live.accept(request("b", "ocr.recognize"))
        await live.accept(request("w", "ocr.warmup"))
        let answered = await waitForResponse(inbox, "w")
        #expect(answered)
        await latch.open()
        _ = await waitForResponse(inbox, "b")
        try? await Task.sleep(for: .milliseconds(50))
        let events = await seen.all
        #expect(events.filter { $0 == "+ocr.recognize" }.count == 2)
        #expect(events.filter { $0 == "-ocr.recognize" }.count == 2)
        #expect(events.contains("+ocr.warmup") && events.contains("-ocr.warmup"))
    }

    @Test func progressLinesCarryTheirStage() {
        let line = Outbound.progress(id: "x", fraction: 0.5, stage: "queued").json
        #expect(line.key("stage")?.string == "queued")
        #expect(Outbound.progress(id: "x", fraction: 0.5).json.key("stage") == nil)
    }

    @Test func ocrIsVersionTwoAndTheRestOne() {
        let versions = serviceVersions(for: [.ocr, .image])
        #expect(versions.key("ocr")?.number == 2)
        #expect(versions.key("image")?.number == 1)
        #expect(HelperService.takesSlot("ocr.warmup") == false)
        #expect(HelperService.takesSlot("ocr.recognize"))
        #expect(HelperService.forMethod("ocr.warmup") == .ocr)
    }
}

private actor Seen {
    var all: [String] = []
    func add(_ event: String) { all.append(event) }
}

private func waitForResponse(_ inbox: Inbox, _ id: String) async -> Bool {
    let deadline = ContinuousClock.now + .seconds(5)
    while ContinuousClock.now < deadline {
        if inbox.snapshot().contains(where: {
            $0.json.key("type")?.string == "response" && $0.json.key("id")?.string == id
        }) { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return false
}
