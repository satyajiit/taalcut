// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
@preconcurrency import Photos

/// PhotoKit serializes callbacks per request. The lock also covers cancellation arriving on another thread.
final class PhotosResourceWriter: @unchecked Sendable {
    private let lock = NSLock()
    private let file: FileHandle
    private let limit: Int64?
    private var request: PHAssetResourceDataRequestID?
    private var cancelled = false
    private var failure: HelperFailure?
    private var count: Int64 = 0
    private var lastEvent = ContinuousClock.now

    init(dest: URL, limit: Int64?) throws {
        let fd = open(dest.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw CocoaError(.fileWriteUnknown) }
        file = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        self.limit = limit
    }

    func attach(_ id: PHAssetResourceDataRequestID) {
        lock.lock()
        request = id
        let stop = cancelled || failure != nil
        lock.unlock()
        if stop { PHAssetResourceManager.default().cancelDataRequest(id) }
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let id = request
        lock.unlock()
        if let id { PHAssetResourceManager.default().cancelDataRequest(id) }
    }

    func write(_ chunk: Data) -> Int64? {
        lock.lock()
        let bytes = writeLocked(chunk)
        let stop = failure != nil ? request : nil
        lock.unlock()
        if let stop { PHAssetResourceManager.default().cancelDataRequest(stop) }
        return bytes
    }

    private func writeLocked(_ chunk: Data) -> Int64? {
        guard !cancelled, failure == nil else { return nil }
        if let limit, Int64(chunk.count) > limit - count {
            failure = .failed("photos.insufficient_space", "Reserved staging space was exhausted", retryable: true)
            return nil
        }
        do {
            try file.write(contentsOf: chunk)
            count += Int64(chunk.count)
        } catch {
            failure = .failed("photos.write_failed", "Could not write selected original", retryable: true)
            return nil
        }
        let now = ContinuousClock.now
        guard now - lastEvent >= .milliseconds(250) else { return nil }
        lastEvent = now
        return count
    }

    func finish(_ error: Error?, networkAllowed: Bool) -> Result<Int64, HelperFailure> {
        lock.lock()
        defer { lock.unlock() }
        defer { try? file.close() }
        if let failure { return .failure(failure) }
        if cancelled { return .failure(.cancelled) }
        if let error {
            let ns = error as NSError
            let cloud = ns.domain == PHPhotosErrorDomain && ns.code == PHPhotosError.Code.networkAccessRequired.rawValue
            return .failure(.failed(
                cloud && !networkAllowed ? "photos.cloud_required" : "photos.export_failed",
                cloud ? "Original requires an explicitly allowed iCloud download" : "Photos could not export the original",
                retryable: !cloud))
        }
        do {
            try file.synchronize()
            return .success(count)
        } catch {
            return .failure(.failed("photos.write_failed", "Could not flush selected original", retryable: true))
        }
    }
}

func photosExport(
    resource: PHAssetResource, selection: PhotosResourceSelection, dest: URL, events: EventPoster
) async -> WorkResponse {
    let writer: PhotosResourceWriter
    do { writer = try PhotosResourceWriter(dest: dest, limit: selection.byteLimit) }
    catch { return .fail(.failed("photos.write_failed", "Could not create staging file", retryable: true)) }
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = selection.allowNetwork
    let result: Result<Int64, HelperFailure> = await withTaskCancellationHandler {
        await withCheckedContinuation { continuation in
            let id = PHAssetResourceManager.default().requestData(for: resource, options: options) { chunk in
                if let bytes = writer.write(chunk) {
                    Task { await photosByteEvent(selection.operationId, bytes: bytes, terminal: false, events: events) }
                }
            } completionHandler: { error in
                continuation.resume(returning: writer.finish(error, networkAllowed: selection.allowNetwork))
            }
            writer.attach(id)
        }
    } onCancel: { writer.cancel() }
    if Task.isCancelled {
        try? FileManager.default.removeItem(at: dest)
        return .fail(.cancelled)
    }
    switch result {
    case .failure(let error):
        try? FileManager.default.removeItem(at: dest)
        return .fail(error)
    case .success(let bytes):
        await photosByteEvent(selection.operationId, bytes: bytes, terminal: true, events: events)
        return .ok(.object(["path": .string(dest.path), "bytesWritten": .number(Double(bytes))]))
    }
}

private func photosByteEvent(_ operationId: String, bytes: Int64, terminal: Bool, events: EventPoster) async {
    await events.post("photos", "bytes", .object([
        "operationId": .string(operationId), "bytesWritten": .number(Double(bytes)), "terminal": .bool(terminal),
    ]))
}
