// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import ImageCaptureCore

final class CameraSlot {
    let handle: String
    let camera: ICCameraDevice
    var catalogueComplete = false
    var lastPercent = -1
    var minted: [ObjectIdentifier: String] = [:]
    let lane = DownloadLane()
    var ptpLane = PtpLane()
    var openingGate: OpenGate?

    init(handle: String, camera: ICCameraDevice) {
        self.handle = handle
        self.camera = camera
    }
}

enum OpenBegan: Sendable {
    case done(WorkResponse)
    case waiting(OpenGate)
}

final class OpenGate: @unchecked Sendable {
    private let lock = NSLock()
    private var arrived = false
    private var error: NSError?
    private var waiters = 0

    func retain() {
        lock.lock()
        waiters += 1
        lock.unlock()
    }

    func release() -> Bool {
        lock.lock()
        waiters = max(0, waiters - 1)
        let empty = waiters == 0
        lock.unlock()
        return empty
    }

    func finish(_ error: Error?) {
        lock.lock()
        self.error = error as NSError?
        arrived = true
        lock.unlock()
    }

    func poll() -> (done: Bool, error: NSError?) {
        lock.lock()
        defer { lock.unlock() }
        return (arrived, error)
    }
}

@MainActor
final class LiveDeviceSession: NSObject, DeviceSession {
    private let browser = ICDeviceBrowser()
    private var started = false
    private var announce = false
    private var slots: [String: CameraSlot] = [:]
    private var byCamera: [ObjectIdentifier: String] = [:]
    private var poster = EventPoster.silent
    private let outbox = DeviceEventQueue()

    nonisolated func start(events: EventPoster) async -> WorkResponse {
        await beginBrowsing(events)
    }

    nonisolated func open(handle: String, events: EventPoster) async -> WorkResponse {
        await openAndWait(handle: handle, events: events)
    }

    nonisolated func list(
        handle: String, cursor: Int?, limit: Int, createdFrom: Double?, createdTo: Double?
    ) async -> WorkResponse {
        await listOnMain(handle: handle, cursor: cursor ?? 0, limit: limit, createdFrom: createdFrom, createdTo: createdTo)
    }

    nonisolated func close(handle: String) async -> WorkResponse {
        await closeOnMain(handle)
    }

    private func beginBrowsing(_ events: EventPoster) -> WorkResponse {
        poster = events
        if !started {
            announce = false
            applyLocalMask()
            browser.delegate = self
            browser.start()
            started = true
            announce = true
        }
        for slot in slots.values { emitAdded(slot) }
        return .ok(.object(["ok": .bool(true)]))
    }

    private func applyLocalMask() {
        let raw = localCameraMaskRawValue()
        if let mask = ICDeviceTypeMask(rawValue: raw) {
            browser.browsedDeviceTypeMask = mask
        }
        if browser.browsedDeviceTypeMask.rawValue != raw {
            browser.setValue(NSNumber(value: raw), forKey: "browsedDeviceTypeMask")
        }
    }

    private func openAndWait(handle: String, events: EventPoster) async -> WorkResponse {
        switch prepareOpen(handle: handle, events: events) {
        case .done(let response):
            return response
        case .waiting(let gate):
            let deadline = ContinuousClock.now + .seconds(120)
            while ContinuousClock.now < deadline {
                if Task.isCancelled {
                    abandon(handle, gate: gate)
                    return .fail(.cancelled)
                }
                let poll = gate.poll()
                if poll.done, let error = poll.error { return failSession(handle, gate: gate, error: error) }
                if let ready = takeReady(handle, gate: gate) { return ready }
                try? await Task.sleep(for: .milliseconds(250))
            }
            return failTimeout(handle, gate: gate)
        }
    }

    private func prepareOpen(handle: String, events: EventPoster) -> OpenBegan {
        poster = events
        guard let slot = slots[handle] else { return .done(.fail(deviceNotFound(handle: handle))) }
        let camera = slot.camera
        if camera.isAccessRestrictedAppleDevice {
            postAccess(slot, .restricted)
            return .done(.fail(deviceFailure(
                code: -9943, domain: "ICErrorDomain", iCloud: camera.iCloudPhotosEnabled, bytesWritten: nil)))
        }
        camera.delegate = self
        _ = applyPresentation(camera)
        if camera.hasOpenSession, slot.catalogueComplete {
            postAccess(slot, .catalogueReady(sessionOpen: true, catalogueComplete: true, restricted: false))
            return .done(.ok(openBody(slot)))
        }
        if let existing = slot.openingGate {
            let status = existing.poll()
            if !status.done || status.error == nil {
                existing.retain()
                return .waiting(existing)
            }
            slot.openingGate = nil
        }
        // A new session builds a new catalogue: a flag left from a closed one must not answer early.
        slot.catalogueComplete = false
        slot.lastPercent = -1
        let gate = OpenGate()
        gate.retain()
        slot.openingGate = gate
        if camera.hasOpenSession {
            gate.finish(nil)
        } else {
            camera.requestOpenSession(options: nil) { error in gate.finish(error) }
        }
        return .waiting(gate)
    }

    private func takeReady(_ handle: String, gate: OpenGate) -> WorkResponse? {
        guard let slot = slots[handle] else {
            _ = gate.release()
            return .fail(deviceNotFound(handle: handle))
        }
        noteCatalog(slot)
        guard slot.catalogueComplete else { return nil }
        _ = gate.release()
        if slot.openingGate === gate { slot.openingGate = nil }
        _ = applyPresentation(slot.camera)
        return .ok(openBody(slot))
    }

    private func openBody(_ slot: CameraSlot) -> JSONValue {
        .object([
            "access": .string(DeviceAccessState.ready.rawValue),
            "iCloudPhotosEnabled": .bool(slot.camera.iCloudPhotosEnabled),
            "count": .number(Double(slot.camera.mediaFiles?.count ?? 0)),
            "ptp": .bool(slot.camera.capabilities.contains(ICDeviceCapability.cameraDeviceCanAcceptPTPCommands.rawValue)),
            "presentation": .string(applyPresentation(slot.camera)),
        ])
    }

    private func failSession(_ handle: String, gate: OpenGate, error: NSError) -> WorkResponse {
        _ = gate.release()
        if slots[handle]?.openingGate === gate { slots[handle]?.openingGate = nil }
        let iCloud = slots[handle]?.camera.iCloudPhotosEnabled
        if let slot = slots[handle], isAccessCode(error.code) {
            postAccess(slot, .errorCode(error.code))
        }
        return .fail(deviceFailure(code: error.code, domain: error.domain, iCloud: iCloud, bytesWritten: nil))
    }

    private func failTimeout(_ handle: String, gate: OpenGate) -> WorkResponse {
        _ = gate.release()
        if slots[handle]?.openingGate === gate { slots[handle]?.openingGate = nil }
        return .fail(catalogTimeout(iCloud: slots[handle]?.camera.iCloudPhotosEnabled))
    }

    private func abandon(_ handle: String, gate: OpenGate) {
        guard gate.release() else { return }
        if slots[handle]?.openingGate === gate { slots[handle]?.openingGate = nil }
        guard let camera = slots[handle]?.camera, camera.hasOpenSession else { return }
        camera.requestCloseSession(options: nil) { _ in }
    }

    private func listOnMain(
        handle: String, cursor: Int, limit: Int, createdFrom: Double?, createdTo: Double?
    ) -> WorkResponse {
        guard let slot = slots[handle] else { return .fail(deviceNotFound(handle: handle)) }
        guard slot.catalogueComplete else {
            return .fail(sessionNotReady(iCloud: slot.camera.iCloudPhotosEnabled))
        }
        let records = mediaRecords(camera: slot.camera, minted: &slot.minted)
        let page = pageItems(records, cursor: cursor, limit: limit, createdFrom: createdFrom, createdTo: createdTo)
        return .ok(itemPageJSON(page))
    }

    private func closeOnMain(_ handle: String) async -> WorkResponse {
        guard let slot = slots[handle] else { return .fail(deviceNotFound(handle: handle)) }
        slot.ptpLane.invalidate()
        slot.ptpLane = PtpLane()
        slot.openingGate = nil
        slot.catalogueComplete = false
        slot.lastPercent = -1
        slot.minted.removeAll()
        if slot.lane.busy { slot.camera.cancelDownload() }
        guard slot.camera.hasOpenSession else { return .ok(.object(["ok": .bool(true)])) }
        return await withCheckedContinuation { continuation in
            let once = ResumeOnce()
            slot.camera.requestCloseSession(options: nil) { _ in
                once.call { continuation.resume(returning: .ok(.object(["ok": .bool(true)]))) }
            }
        }
    }

    func register(_ device: ICDevice) {
        guard let camera = device as? ICCameraDevice else { return }
        let key = ObjectIdentifier(camera)
        if byCamera[key] != nil { return }
        let handle = UUID().uuidString
        let slot = CameraSlot(handle: handle, camera: camera)
        slots[handle] = slot
        byCamera[key] = handle
        camera.delegate = self
        guard announce else { return }
        emitAdded(slot)
    }

    func unregister(_ device: ICDevice) {
        guard let handle = byCamera.removeValue(forKey: ObjectIdentifier(device)) else { return }
        if let slot = slots.removeValue(forKey: handle) {
            slot.ptpLane.invalidate()
            slot.openingGate = nil
        }
        guard announce else { return }
        outbox.post(poster, "device.removed", .object(["handle": .string(handle)]))
    }

    func markReady(_ camera: ICCameraDevice) {
        guard let handle = byCamera[ObjectIdentifier(camera)], let slot = slots[handle] else { return }
        slot.catalogueComplete = true
        noteCatalog(slot)
        if slot.lastPercent < 100 {
            slot.lastPercent = 100
            outbox.post(poster, "device.catalog", .object([
                "handle": .string(handle), "percent": .number(100),
            ]))
        }
        let restricted = camera.isAccessRestrictedAppleDevice
        postAccess(slot, .catalogueReady(sessionOpen: true, catalogueComplete: true, restricted: restricted))
    }

    func sessionClosed(_ device: ICDevice) {
        guard let handle = byCamera[ObjectIdentifier(device)], let slot = slots[handle] else { return }
        slot.ptpLane.invalidate()
        slot.ptpLane = PtpLane()
        slot.openingGate = nil
        slot.catalogueComplete = false
        slot.lastPercent = -1
    }

    func restrict(_ device: ICDevice, enabled: Bool) {
        guard let handle = byCamera[ObjectIdentifier(device)], let slot = slots[handle] else { return }
        if enabled {
            postAccess(slot, .restrictionEnabled)
            return
        }
        postAccess(slot, .catalogueReady(
            sessionOpen: slot.camera.hasOpenSession, catalogueComplete: slot.catalogueComplete, restricted: false))
    }

    func slot(_ handle: String) -> CameraSlot? { slots[handle] }

    func remember(_ events: EventPoster) { poster = events }

    fileprivate func emitAdded(_ slot: CameraSlot) {
        let camera = slot.camera
        outbox.post(poster, "device.added", deviceAddedJSON(
            handle: slot.handle, label: camera.name ?? "", productKind: camera.productKind ?? "",
            serial: camera.serialNumberString, usbLocation: Int(camera.usbLocationID)))
        if camera.isAccessRestrictedAppleDevice { postAccess(slot, .restricted) }
    }

    fileprivate func noteCatalog(_ slot: CameraSlot) {
        let percent = Int(slot.camera.contentCatalogPercentCompleted)
        guard percent != slot.lastPercent else { return }
        slot.lastPercent = percent
        outbox.post(poster, "device.catalog", .object([
            "handle": .string(slot.handle), "percent": .number(Double(percent)),
        ]))
    }

    fileprivate func postAccess(_ slot: CameraSlot, _ signal: AccessSignal) {
        outbox.post(poster, "device.access", accessEventJSON(handle: slot.handle, reading: accessReading(signal)))
    }

    @discardableResult
    func applyPresentation(_ camera: ICCameraDevice) -> String {
        if camera.capabilities.contains(ICDeviceCapability.cameraDeviceSupportsHEIF.rawValue) {
            camera.mediaPresentation = .originalAssets
            return "original"
        }
        return "converted"
    }
}

private func isAccessCode(_ code: Int) -> Bool {
    code == -9943 || code == -9951 || code == -21343 || code == -9927
}

final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var fired = false

    func call(_ body: () -> Void) {
        lock.lock()
        let first = !fired
        fired = true
        lock.unlock()
        if first { body() }
    }
}
