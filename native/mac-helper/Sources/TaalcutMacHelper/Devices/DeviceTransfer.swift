// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import ImageCaptureCore
import ImageIO

final class DataBox: @unchecked Sendable {
    private let lock = NSLock()
    private var arrived = false
    private var data: Data?
    private var error: NSError?

    func finish(_ data: Data?, _ error: Error?) {
        lock.lock()
        self.data = data
        self.error = error as NSError?
        arrived = true
        lock.unlock()
    }

    func poll() -> (done: Bool, data: Data?, error: NSError?) {
        lock.lock()
        defer { lock.unlock() }
        return (arrived, data, error)
    }
}

private struct TransferView: Sendable {
    var finished: Bool
    var failure: HelperFailure?
    var bytes: Int64
    var total: Int64
}

extension LiveDeviceSession {
    nonisolated func thumbnail(handle: String, id: String, maxPixel: Int, dest: URL) async -> WorkResponse {
        switch await requestThumbnail(handle: handle, id: id, maxPixel: maxPixel) {
        case .failure(let failure):
            return .fail(failure)
        case .success(let box):
            let deadline = ContinuousClock.now + .seconds(60)
            while ContinuousClock.now < deadline {
                if Task.isCancelled { return .fail(.cancelled) }
                let poll = box.poll()
                if poll.done { return writeThumbnail(poll.data, error: poll.error, dest: dest, iCloud: await cloud(handle)) }
                try? await Task.sleep(for: .milliseconds(50))
            }
            return .fail(catalogTimeout(iCloud: await cloud(handle)))
        }
    }

    nonisolated func download(
        handle: String, id: String, destDir: URL, events: EventPoster, progress: @escaping @Sendable (Double) -> Void
    ) async -> WorkResponse {
        switch await beginDownload(handle: handle, id: id, destDir: destDir, events: events) {
        case .failure(let failure):
            return .fail(failure)
        case .success(let ticket):
            var watch = StallWatch(limit: downloadStallLimit, now: ContinuousClock.now)
            while true {
                if Task.isCancelled {
                    await abandonDownload(handle, ticket: ticket)
                    return .fail(.cancelled)
                }
                let view = await transferView(handle, ticket: ticket)
                let now = ContinuousClock.now
                if watch.note(bytes: view.bytes, at: now), view.bytes > 0 || view.total > 0 {
                    await events.post("devices", "download.progress", .object([
                        "handle": .string(handle), "id": .string(id),
                        "bytes": .number(Double(view.bytes)), "total": .number(Double(view.total)),
                    ]))
                    let fraction = view.total > 0 ? Double(view.bytes) / Double(view.total) : 0
                    progress(min(1, max(0, fraction)))
                }
                if view.finished {
                    if let failure = view.failure { return .fail(failure) }
                    return hashDownload(ticket)
                }
                if watch.stalled(at: now) {
                    await abandonDownload(handle, ticket: ticket)
                    return .fail(.failed(
                        "devices.download_failed", "download stalled", retryable: true,
                        detail: deviceDetail(
                            domain: "ICErrorDomain", code: 0, iCloud: ticket.iCloud, bytesWritten: view.bytes)))
                }
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
    }

    nonisolated func cancel(handle: String) async -> WorkResponse {
        await cancelOnMain(handle)
    }

    nonisolated func ptp(handle: String, command: Data, outData: Data?) async -> WorkResponse {
        switch await requestPtp(handle: handle, command: command, outData: outData) {
        case .failure(let failure):
            return .fail(failure)
        case .success(let box):
            switch await box.wait() {
            case .cancelled:
                return .fail(.cancelled)
            case .timedOut:
                return .fail(catalogTimeout(iCloud: await cloud(handle)))
            case .completed(let reply):
                if let error = reply.error {
                    return .fail(deviceFailure(
                        code: error.code, domain: error.domain, iCloud: await cloud(handle), bytesWritten: nil))
                }
                return .ok(.object([
                    "data": .string((reply.dataIn ?? Data()).base64EncodedString()),
                    "response": .string((reply.response ?? Data()).base64EncodedString()),
                ]))
            }
        }
    }

    private func requestPtp(handle: String, command: Data, outData: Data?) -> Result<PtpBox, HelperFailure> {
        if Task.isCancelled { return .failure(.cancelled) }
        guard let slot = slot(handle) else { return .failure(deviceNotFound(handle: handle)) }
        guard slot.camera.hasOpenSession else {
            return .failure(sessionNotReady(iCloud: slot.camera.iCloudPhotosEnabled))
        }
        let box = PtpBox()
        guard slot.ptpLane.hold(box) else {
            return .failure(.failed(
                "devices.session_failed", "a PTP command is still completing", retryable: true,
                detail: deviceDetail(domain: "ICErrorDomain", code: 0, iCloud: slot.camera.iCloudPhotosEnabled, bytesWritten: nil)))
        }
        slot.camera.requestSendPTPCommand(command, outData: outData) { dataIn, response, error in
            box.finish(dataIn, response, error)
        }
        return .success(box)
    }

    private func requestThumbnail(handle: String, id: String, maxPixel: Int) -> Result<DataBox, HelperFailure> {
        guard let slot = slot(handle) else { return .failure(deviceNotFound(handle: handle)) }
        guard slot.catalogueComplete else { return .failure(sessionNotReady(iCloud: slot.camera.iCloudPhotosEnabled)) }
        guard let file = findCameraFile(id, camera: slot.camera, minted: &slot.minted) else {
            return .failure(deviceNotFound(handle: id))
        }
        let box = DataBox()
        file.requestThumbnailData(options: [
            ICCameraItemThumbnailOption.imageSourceThumbnailMaxPixelSize: maxPixel,
        ]) { data, error in
            box.finish(data, error)
        }
        return .success(box)
    }

    private func beginDownload(
        handle: String, id: String, destDir: URL, events: EventPoster
    ) -> Result<DownloadTicket, HelperFailure> {
        remember(events)
        guard let slot = slot(handle) else { return .failure(deviceNotFound(handle: handle)) }
        guard slot.catalogueComplete else { return .failure(sessionNotReady(iCloud: slot.camera.iCloudPhotosEnabled)) }
        if slot.lane.busy {
            return .failure(.failed(
                "devices.session_failed", "a download is already running", retryable: true,
                detail: deviceDetail(domain: "ICErrorDomain", code: 0, iCloud: slot.camera.iCloudPhotosEnabled, bytesWritten: nil)))
        }
        guard let file = findCameraFile(id, camera: slot.camera, minted: &slot.minted) else {
            return .failure(deviceNotFound(handle: id))
        }
        let plan = DownloadPlan.make(directory: destDir, filename: id)
        deleteShorter(plan, file: file)
        let presentation = applyPresentation(slot.camera)
        let ticket = DownloadTicket(
            id: id, directory: destDir, before: directoryNames(destDir), presentation: presentation,
            iCloud: slot.camera.iCloudPhotosEnabled)
        guard slot.lane.hold(ticket) else { return .failure(sessionNotReady(iCloud: ticket.iCloud)) }
        let started = file.requestDownload(options: plan.options) { filename, error in
            ticket.finish(filename: filename, error: error)
        }
        slot.lane.attach(started, to: ticket)
        return .success(ticket)
    }

    /// Bytes so far, or the outcome once the ticket finished (which releases the lane).
    private func transferView(_ handle: String, ticket: DownloadTicket) -> TransferView {
        guard let slot = slot(handle) else {
            return TransferView(finished: true, failure: deviceNotFound(handle: handle), bytes: 0, total: 0)
        }
        let bytes = slot.lane.bytes(for: ticket)
        let poll = ticket.poll()
        guard poll.done else {
            return TransferView(finished: false, failure: nil, bytes: bytes.completed, total: bytes.total)
        }
        slot.lane.release(ticket)
        if let error = poll.error {
            let written = placedFile(ticket.directory, filename: poll.filename ?? ticket.id).flatMap(fileByteCount)
            return TransferView(
                finished: true,
                failure: deviceFailure(code: error.code, domain: error.domain, iCloud: ticket.iCloud, bytesWritten: written),
                bytes: written ?? 0, total: bytes.total)
        }
        return TransferView(finished: true, failure: nil, bytes: bytes.completed, total: bytes.total)
    }

    /// A cancelled or stalled download: stop ImageCaptureCore and free the lane now, so the next
    /// download is not refused while nothing polls this one any more.
    private func abandonDownload(_ handle: String, ticket: DownloadTicket) {
        guard let slot = slot(handle), slot.lane.holds(ticket) else { return }
        if !ticket.poll().done { slot.camera.cancelDownload() }
        slot.lane.release(ticket)
    }

    private func cancelOnMain(_ handle: String) -> WorkResponse {
        guard let slot = slot(handle) else { return .fail(deviceNotFound(handle: handle)) }
        guard let ticket = slot.lane.ticket, slot.lane.busy else { return .ok(.object(["cancelled": .bool(false)])) }
        abandonDownload(handle, ticket: ticket)
        return .ok(.object(["cancelled": .bool(true)]))
    }

    private func cloud(_ handle: String) -> Bool? { slot(handle)?.camera.iCloudPhotosEnabled }
}

private func hashDownload(_ ticket: DownloadTicket) -> WorkResponse {
    let poll = ticket.poll()
    guard let url = placedFile(ticket.directory, filename: poll.filename ?? ticket.id) else {
        return .fail(.pathNotAllowed)
    }
    let bytes = fileByteCount(url) ?? 0
    if bytes <= 0 {
        let code = poll.error?.code ?? -21447
        let domain = poll.error?.domain ?? "ICErrorDomain"
        return .fail(emptyItemFailure(domain: domain, code: code, iCloud: ticket.iCloud, bytesWritten: bytes))
    }
    let digest: String
    do {
        digest = try sha256Hex(of: url)
    } catch {
        return .fail(.failed(
            "devices.download_failed", "could not hash the file", retryable: true,
            detail: deviceDetail(domain: "ICErrorDomain", code: 0, iCloud: ticket.iCloud, bytesWritten: bytes)))
    }
    let names = ancillaryNames(before: ticket.before, after: directoryNames(ticket.directory), primary: url.lastPathComponent)
    return .ok(.object([
        "file": .string(url.path),
        "bytes": .number(Double(bytes)),
        "sha256": .string(digest),
        "ancillary": .array(names.map { .string($0) }),
        "presentation": .string(ticket.presentation),
    ]))
}

private func writeThumbnail(_ data: Data?, error: NSError?, dest: URL, iCloud: Bool?) -> WorkResponse {
    if let error {
        return .fail(deviceFailure(code: error.code, domain: error.domain, iCloud: iCloud, bytesWritten: nil))
    }
    guard let data, !data.isEmpty else { return .ok(.object(["path": .null])) }
    do {
        try data.write(to: dest, options: .atomic)
    } catch {
        return .fail(.failed(
            "devices.session_failed", "could not write the thumbnail", retryable: true,
            detail: deviceDetail(domain: "ICErrorDomain", code: 0, iCloud: iCloud, bytesWritten: nil)))
    }
    var body: [String: JSONValue] = ["path": .string(dest.path)]
    if let size = jpegPixelSize(data) {
        body["width"] = .number(Double(size.0))
        body["height"] = .number(Double(size.1))
    }
    return .ok(.object(body))
}

/// A short leftover of this item from an earlier attempt, named by the phone. Only a plain file name
/// is used, and only inside the download folder.
private func deleteShorter(_ plan: DownloadPlan, file: ICCameraFile) {
    let inside = PathConfinement(roots: [plan.directory.path])
    let names = [plan.filename, file.originalFilename, file.name].compactMap { $0.flatMap(leafName) }
    for name in Set(names) {
        guard case .success(let url) = inside.resolve(plan.directory.appendingPathComponent(name).path),
            shorterLeftover(bytes: fileByteCount(url), expected: Int64(file.fileSize))
        else { continue }
        do {
            try FileManager.default.removeItem(at: url)
        } catch {
            deviceWarning("could not remove a short leftover (\((error as NSError).domain) \((error as NSError).code))")
        }
    }
}

private func jpegPixelSize(_ data: Data) -> (Int, Int)? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let width = (props[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
        let height = (props[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue
    else { return nil }
    return (width, height)
}
