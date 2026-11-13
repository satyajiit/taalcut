// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

@Suite struct DevicesTests {
    @Test func addedEventNamesPlatformAndIdentity() {
        let phone = deviceAddedJSON(handle: "h", label: "Phone", productKind: "iPhone", serial: " ABC ", usbLocation: 7)
        #expect(phone.key("platform")?.string == "ios")
        #expect(phone.key("identity")?.string == "ABC")
        #expect(phone.key("handle")?.string == "h")
        let pad = deviceAddedJSON(handle: "p", label: "Pad", productKind: "iPad", serial: nil, usbLocation: 3)
        #expect(pad.key("platform")?.string == "ios")
        #expect(pad.key("identity")?.string == "3")
        let camera = deviceAddedJSON(handle: "c", label: "Cam", productKind: "Camera", serial: "  ", usbLocation: 9)
        #expect(camera.key("platform")?.string == "other")
        #expect(camera.key("identity")?.string == "9")
        #expect(localCameraMaskRawValue() == 0x101)
    }

    @Test func coarseKindsAndDatePages() {
        #expect(coarseMediaKind(uti: "public.heic") == "image")
        #expect(coarseMediaKind(uti: "public.mpeg-4") == "movie")
        #expect(coarseMediaKind(uti: "public.audio") == "audio")
        #expect(coarseMediaKind(uti: "com.example") == "data")
        let early = record("a", created: 1_000)
        let late = record("b", created: 5_000)
        let undated = record("c", created: nil)
        let page = pageItems([early, undated, late], cursor: 0, limit: 10, createdFrom: 2_000, createdTo: 6_000)
        #expect(page.items.map(\.id) == ["b"])
        let first = pageItems([early, late], cursor: 0, limit: 1, createdFrom: nil, createdTo: nil)
        #expect(first.items.map(\.id) == ["a"])
        #expect(first.nextCursor == 1)
        let past = pageItems([early], cursor: 4, limit: 10, createdFrom: nil, createdTo: nil)
        #expect(past.items.isEmpty)
        #expect(past.nextCursor == nil)
    }

    @Test func accessCodesAndDownloadPlan() {
        #expect(accessReading(.errorCode(-9943)).state == .locked)
        #expect(accessReading(.errorCode(-9951)).state == .notTrusted)
        let busy = accessReading(.errorCode(-21343))
        #expect(busy.state == .busy)
        #expect(busy.holder == "camera-agent")
        let ready = accessReading(.catalogueReady(sessionOpen: true, catalogueComplete: true, restricted: false))
        #expect(ready.state == .ready)
        #expect(accessReading(.restricted).state == .locked)
        let locked = deviceFailure(code: -9943, domain: "ICErrorDomain", iCloud: nil, bytesWritten: nil)
        #expect(locked.code == "devices.locked")
        #expect(locked.retryable == false)
        let failed = deviceFailure(code: -9934, domain: "ICErrorDomain", iCloud: false, bytesWritten: 4)
        #expect(failed.code == "devices.download_failed")
        #expect(failed.retryable == true)
        let cancelled = deviceFailure(code: -9937, domain: "ICErrorDomain", iCloud: nil, bytesWritten: nil)
        #expect(cancelled.retryable == false)
        let empty = deviceFailure(code: -21447, domain: "ICErrorDomain", iCloud: nil, bytesWritten: 0)
        #expect(empty.code == "devices.item_empty")
        #expect(empty.retryable == false)
        let withHolder = accessEventJSON(handle: "h", reading: busy)
        #expect(withHolder.key("holder")?.string == "camera-agent")
        let without = accessEventJSON(handle: "h", reading: ready)
        #expect(without.key("holder") == nil)
        var plan = DownloadPlan.make(directory: URL(fileURLWithPath: "/tmp"), filename: "1")
        #expect(plan.keepsOriginals)
        plan.deleteAfter = true
        #expect(plan.keepsOriginals == false)
        #expect(shorterLeftover(bytes: 10, expected: 20))
        #expect(shorterLeftover(bytes: 20, expected: 20) == false)
        #expect(shorterLeftover(bytes: nil, expected: 20) == false)
        #expect(ancillaryNames(before: ["a.jpg"], after: ["a.jpg", "a.aae", "b.jpg"], primary: "a.jpg") == ["a.aae", "b.jpg"])
    }

    @Test func hashesTheFileThatWasWritten() throws {
        let root = try DeviceScratch()
        let file = root.url.appendingPathComponent("abc.bin")
        try Data("abc".utf8).write(to: file)
        #expect(try sha256Hex(of: file) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        #expect(fileByteCount(file) == 3)
    }

    @Test func openGateKeepsSessionUntilLastWaiterReleases() {
        let gate = OpenGate()
        gate.retain()
        gate.retain()
        #expect(gate.poll().done == false)
        #expect(gate.release() == false)
        gate.finish(nil)
        #expect(gate.poll().done == true)
        #expect(gate.poll().error == nil)
        #expect(gate.release() == true)
    }

    @Test func serviceRoutesAndRejectsBadPages() async throws {
        let fake = FakeSession()
        let service = DevicesService(session: fake)
        let root = try DeviceScratch()
        let confinement = PathConfinement(roots: [root.url.path])
        let started = await service.handle(
            method: "devices.start", params: .object([:]), progress: { _ in },
            events: .silent, confinement: confinement)
        #expect(started.result?.key("ok")?.bool == true)
        let limit = await service.handle(
            method: "devices.list",
            params: .object(["handle": .string("h"), "limit": .number(0)]),
            progress: { _ in }, events: .silent, confinement: confinement)
        #expect(limit.failure?.code == "helper.bad_request")
        let huge = await service.handle(
            method: "devices.list",
            params: .object(["handle": .string("h"), "limit": .number(501)]),
            progress: { _ in }, events: .silent, confinement: confinement)
        #expect(huge.failure?.code == "helper.bad_request")
        let fraction = await service.handle(
            method: "devices.list",
            params: .object(["handle": .string("h"), "limit": .number(100.5)]),
            progress: { _ in }, events: .silent, confinement: confinement)
        #expect(fraction.failure?.code == "helper.bad_request")
        let cursor = await service.handle(
            method: "devices.list",
            params: .object(["handle": .string("h"), "cursor": .number(-1)]),
            progress: { _ in }, events: .silent, confinement: confinement)
        #expect(cursor.failure?.code == "helper.bad_request")
        let outside = await service.handle(
            method: "devices.download",
            params: .object([
                "handle": .string("h"), "id": .string("item"),
                "destDir": .string("/etc"),
            ]),
            progress: { _ in }, events: .silent, confinement: confinement)
        #expect(outside.failure?.code == "helper.path_not_allowed")
        let file = root.url.appendingPathComponent("not-a-dir")
        try Data("x".utf8).write(to: file)
        let notDir = await service.handle(
            method: "devices.download",
            params: .object([
                "handle": .string("h"), "id": .string("item"),
                "destDir": .string(file.path),
            ]),
            progress: { _ in }, events: .silent, confinement: confinement)
        #expect(notDir.failure?.code == "helper.bad_request")
        let pixel = await service.handle(
            method: "devices.thumbnail",
            params: .object([
                "handle": .string("h"), "id": .string("item"),
                "maxPixel": .number(0),
                "dest": .string(root.url.appendingPathComponent("thumb.jpg").path),
            ]),
            progress: { _ in }, events: .silent, confinement: confinement)
        #expect(pixel.failure?.code == "helper.bad_request")
        let shortPtp = await service.handle(
            method: "devices.ptp",
            params: .object(["handle": .string("h"), "command": .string(Data([1, 2, 3]).base64EncodedString())]),
            progress: { _ in }, events: .silent, confinement: confinement)
        #expect(shortPtp.failure?.code == "helper.bad_request")
        let okPtp = await service.handle(
            method: "devices.ptp",
            params: .object(["handle": .string("h"), "command": .string(Data(repeating: 0, count: 12).base64EncodedString())]),
            progress: { _ in }, events: .silent, confinement: confinement)
        #expect(okPtp.result?.key("response")?.string != nil)
        #expect(await fake.methods == ["start", "ptp"])
    }
}

private func record(_ id: String, created: Double?) -> MediaRecord {
    MediaRecord(
        id: id, name: id, uti: "image", size: 1, width: nil, height: nil, duration: nil,
        created: created, modified: nil, folder: nil, relatedUUID: nil, groupUUID: nil, burstUUID: nil,
        highFramerate: false, timeLapse: false, sidecars: [], wasAddedAfterCatalog: false)
}

private actor FakeSession: DeviceSession {
    var methods: [String] = []

    func start(events: EventPoster) async -> WorkResponse {
        _ = events
        methods.append("start")
        return .ok(.object(["ok": .bool(true)]))
    }

    func open(handle: String, events: EventPoster) async -> WorkResponse {
        _ = handle
        _ = events
        methods.append("open")
        return .ok(.object(["ok": .bool(true)]))
    }

    func list(
        handle: String, cursor: Int?, limit: Int, createdFrom: Double?, createdTo: Double?
    ) async -> WorkResponse {
        _ = handle
        _ = cursor
        _ = limit
        _ = createdFrom
        _ = createdTo
        methods.append("list")
        return .ok(.object(["items": .array([])]))
    }

    func thumbnail(handle: String, id: String, maxPixel: Int, dest: URL) async -> WorkResponse {
        _ = handle
        _ = id
        _ = maxPixel
        _ = dest
        methods.append("thumbnail")
        return .ok(.object(["path": .null]))
    }

    func download(
        handle: String, id: String, destDir: URL, events: EventPoster,
        progress: @escaping @Sendable (Double) -> Void
    ) async -> WorkResponse {
        _ = handle
        _ = id
        _ = destDir
        _ = events
        _ = progress
        methods.append("download")
        return .ok(.object(["ok": .bool(true)]))
    }

    func cancel(handle: String) async -> WorkResponse {
        _ = handle
        methods.append("cancel")
        return .ok(.object(["cancelled": .bool(false)]))
    }

    func close(handle: String) async -> WorkResponse {
        _ = handle
        methods.append("close")
        return .ok(.object(["ok": .bool(true)]))
    }

    func ptp(handle: String, command: Data, outData: Data?) async -> WorkResponse {
        _ = handle
        _ = command
        _ = outData
        methods.append("ptp")
        return .ok(.object([
            "data": .string(""),
            "response": .string(Data(repeating: 0, count: 12).base64EncodedString()),
        ]))
    }
}

private struct DeviceScratch {
    let url: URL
    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-devices-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}
