// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import AppKit
@preconcurrency import Photos

final class PhotosThumbnailTicket: @unchecked Sendable {
    private let lock = NSLock()
    private var request: PHImageRequestID?
    private var cancelled = false
    private var completed = false
    private var continuation: CheckedContinuation<WorkResponse, Never>?

    func install(_ continuation: CheckedContinuation<WorkResponse, Never>) {
        lock.lock()
        let stop = cancelled
        if !stop { self.continuation = continuation }
        lock.unlock()
        if stop { continuation.resume(returning: .fail(.cancelled)) }
    }

    func attach(_ id: PHImageRequestID) {
        lock.lock()
        request = id
        let stop = cancelled
        lock.unlock()
        if stop { PHImageManager.default().cancelImageRequest(id) }
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let id = request
        let reply = continuation
        continuation = nil
        completed = true
        lock.unlock()
        if let id { PHImageManager.default().cancelImageRequest(id) }
        reply?.resume(returning: .fail(.cancelled))
    }

    func finish(_ work: () -> WorkResponse) {
        lock.lock()
        guard !completed, !cancelled else { lock.unlock(); return }
        completed = true
        let response = work()
        let reply = continuation
        continuation = nil
        lock.unlock()
        reply?.resume(returning: response)
    }
}

func photosThumbnail(asset: PHAsset, dest: URL) async -> WorkResponse {
    let ticket = PhotosThumbnailTicket()
    let options = PHImageRequestOptions()
    options.isNetworkAccessAllowed = false
    options.version = .original
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .fast
    return await withTaskCancellationHandler {
        await withCheckedContinuation { continuation in
            ticket.install(continuation)
            let id = PHImageManager.default().requestImage(
                for: asset, targetSize: CGSize(width: 256, height: 256), contentMode: .aspectFit, options: options
            ) { image, info in
                if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
                ticket.finish {
                    if (info?[PHImageCancelledKey] as? Bool) == true { return .fail(.cancelled) }
                    guard let image, let tiff = image.tiffRepresentation,
                          let bitmap = NSBitmapImageRep(data: tiff),
                          let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
                        // A cloud-only thumbnail is an ordinary unavailable preview, never a download request.
                        return .ok(.object(["path": .null]))
                    }
                    do {
                        try data.write(to: dest, options: [.withoutOverwriting])
                        return .ok(.object(["path": .string(dest.path)]))
                    } catch {
                        return .fail(.failed("photos.write_failed", "Could not save thumbnail", retryable: true))
                    }
                }
            }
            ticket.attach(id)
        }
    } onCancel: { ticket.cancel() }
}
