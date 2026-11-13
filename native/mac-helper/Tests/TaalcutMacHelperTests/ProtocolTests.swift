// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

private func session(
    started: Set<HelperService>, inbox: Inbox, latch: Latch? = nil, hold: String? = nil, events: Bool = false
) -> ProtocolSession {
    ProtocolSession(
        started: started,
        handler: { method, _, _, poster in
            if method == hold { await latch?.waitUntilOpen() }
            if events && method == "ocr.languages" {
                await poster.post("devices", "device.added", .object(["handle": .string("h1")]))
            }
            try? await Task.sleep(for: .milliseconds(method == "asr.load" ? 200 : 1))
            return .ok(.object(["method": .string(method)]))
        },
        sink: { inbox.append($0) })
}

@Suite struct ProtocolTests {
    @Test func requestAndMalformedThenLives() async {
        let inbox = Inbox()
        let live = session(started: [.ocr], inbox: inbox, events: true)
        await live.accept("not-json")
        await live.accept("")
        await live.accept(request("ok", "ocr.languages"))
        let replies = await inbox.waitFor(3)
        #expect(replies.count == 3)
        #expect(replies[0].json.key("ok")?.bool == false)
        #expect(replies[0].json.key("error")?.key("code")?.string == "helper.bad_request")
        let event = replies[1].json
        #expect(event.key("type")?.string == "event")
        #expect(event.key("service")?.string == "devices")
        #expect(event.key("name")?.string == "device.added")
        #expect(event.key("data")?.key("handle")?.string == "h1")
        #expect(replies[2].json.key("id")?.string == "ok")
        #expect(replies[2].json.key("ok")?.bool == true)
        #expect(replies[2].json.key("type")?.string == "response")
    }

    @Test func repliesMayFinishOutOfOrder() async {
        let inbox = Inbox()
        let latch = Latch()
        let live = session(started: [.ocr], inbox: inbox, latch: latch, hold: "ocr.recognize")
        await live.accept(request("slow", "ocr.recognize"))
        await live.accept(request("fast", "ocr.languages"))
        let first = await inbox.waitFor(1)
        #expect(first.first?.json.key("id")?.string == "fast")
        await latch.open()
        let both = await inbox.waitFor(2)
        #expect(both.map { $0.json.key("id")?.string } == ["fast", "slow"])
    }

    @Test func cancelWhileQueued() async {
        let inbox = Inbox()
        let latch = Latch()
        let live = session(started: [.asr], inbox: inbox, latch: latch, hold: "asr.load")
        await live.accept(request("holder", "asr.load"))
        try? await Task.sleep(for: .milliseconds(40))
        await live.accept(request("queued", "asr.transcribe"))
        try? await Task.sleep(for: .milliseconds(40))
        await live.accept(#"{"id":"queued","type":"cancel"}"#)
        let cancelled = await inbox.waitFor(1)
        #expect(cancelled.first?.json.key("id")?.string == "queued")
        #expect(cancelled.first?.json.key("error")?.key("code")?.string == "helper.cancelled")
        await latch.open()
        _ = await inbox.waitFor(2)
    }

    @Test func rejectsEmptyIdUnknownMethodAndStoppedService() async {
        let inbox = Inbox()
        let live = session(started: [.ocr], inbox: inbox)
        await live.accept(#"{"id":"","method":"ocr.languages","type":"request"}"#)
        await live.accept(request("m", "nope.nope"))
        await live.accept(request("s", "asr.load"))
        await live.oversized()
        let replies = await inbox.waitFor(4)
        let codes = replies.compactMap { $0.json.key("error")?.key("code")?.string }
        #expect(codes == [
            "helper.bad_request", "helper.unknown_method", "helper.service_not_started", "helper.bad_request",
        ])
    }

    @Test func shutdownWaitsForInFlightWork() async {
        let inbox = Inbox()
        let live = session(started: [.asr], inbox: inbox)
        await live.accept(request("work", "asr.load"))
        await live.shutdown()
        let replies = inbox.snapshot()
        #expect(replies.first?.json.key("ok")?.bool == true)
        #expect(await live.inFlight() == 0)
    }

    @Test func idleLeavesInFlightWorkAlone() async {
        let inbox = Inbox()
        let latch = Latch()
        let live = session(started: [.asr], inbox: inbox, latch: latch, hold: "asr.load")
        let (stream, continuation) = AsyncStream.makeStream(of: PumpEvent.self)
        let finished = Flag()
        let loop = Task {
            await serveLoop(events: stream, session: live, idle: .zero)
            await finished.mark()
        }
        continuation.yield(.line(request("busy", "asr.load")))
        try? await Task.sleep(for: .milliseconds(40))
        continuation.yield(.tick)
        try? await Task.sleep(for: .milliseconds(40))
        #expect(await finished.isSet == false)
        await latch.open()
        _ = await inbox.waitFor(1)
        continuation.yield(.tick)
        try? await Task.sleep(for: .milliseconds(80))
        #expect(await finished.isSet == true)
        continuation.finish()
        await loop.value
    }

    @Test func endOfStdinFinishesInFlightWork() async {
        let inbox = Inbox()
        let live = session(started: [.asr], inbox: inbox)
        let (stream, continuation) = AsyncStream.makeStream(of: PumpEvent.self)
        let loop = Task {
            await serveLoop(events: stream, session: live, idle: nil)
        }
        continuation.yield(.line(request("last", "asr.load")))
        continuation.yield(.eof)
        await loop.value
        let replies = await inbox.waitFor(1)
        #expect(replies.first?.json.key("id")?.string == "last")
        #expect(replies.first?.json.key("ok")?.bool == true)
    }

    @Test func readyLineAndRejectedFlags() async {
        let ready = readyLine(
            config: ServeConfig(
                services: [.image, .ocr], roots: ["/tmp"], models: nil, idleSeconds: nil, forceLegacy: false),
            ocr: OcrEngine())
        #expect(ready.key("type")?.string == "ready")
        #expect(ready.key("protocol")?.number == 2)
        #expect(ready.key("services")?.array?.compactMap(\.string) == ["ocr", "image"])
        #expect(ready.key("serviceVersions")?.key("ocr")?.number == 2)
        #expect(ready.key("serviceVersions")?.key("image")?.number == 1)
        #expect(ready.key("serviceVersions")?.key("text")?.number == 1)
        #expect(ready.key("serviceVersions")?.key("devices") == nil)
        #expect(ready.key("ocr")?.key("revision")?.number == 3)
        #expect(parseArguments(["bin", "--nope"]) .isFailure)
        let missingModels = await HelperCommand.run(
            ["bin", "serve", "--services", "asr", "--allow-root", "/tmp"])
        #expect(missingModels == 2)
        let mixed = await HelperCommand.run(
            ["bin", "serve", "--services", "ocr,asr", "--allow-root", "/tmp", "--models", "/tmp"])
        #expect(mixed == 2)
        let missingRoot = await HelperCommand.run(
            ["bin", "serve", "--services", "ocr", "--allow-root", "/no/such/taalcut-root"])
        #expect(missingRoot == 2)
        let idleOff = parseArguments(
            ["bin", "serve", "--services", "devices", "--allow-root", "/tmp", "--idle-exit", "0"])
        if case .success(.serve(let config)) = idleOff {
            #expect(config.idleSeconds == nil)
            #expect(config.services == [.devices])
        } else {
            Issue.record("idle-exit 0 should parse")
        }
        let mixedDevices = await HelperCommand.run(
            ["bin", "serve", "--services", "devices,ocr", "--allow-root", "/tmp"])
        #expect(mixedDevices == 2)
    }

    @Test func stoppedDeviceServiceAndV1ResponseShape() async {
        let inbox = Inbox()
        let live = session(started: [.ocr], inbox: inbox)
        await live.accept(request("d", "devices.list"))
        await live.accept(request("g", "video.applyCube"))
        await live.accept(request("t", "track.shot"))
        let replies = await inbox.waitFor(3)
        let codes = replies.compactMap { $0.json.key("error")?.key("code")?.string }
        #expect(codes == [
            "helper.service_not_started", "helper.service_not_started", "helper.service_not_started",
        ])
        let response = replies[0].json
        #expect(response.key("type")?.string == "response")
        #expect(response.key("ok")?.bool == false)
        #expect(response.object?.keys.contains("result") == false)
    }
}

extension Result where Failure == UsageError {
    fileprivate var isFailure: Bool {
        if case .failure = self { return true }
        return false
    }
}
