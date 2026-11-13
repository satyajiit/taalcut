// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import ImageCaptureCore

extension LiveDeviceSession: ICDeviceBrowserDelegate, ICCameraDeviceDelegate {
    nonisolated func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        hop(device) { self.register($0) }
        _ = browser
        _ = moreComing
    }

    nonisolated func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        hop(device) { self.unregister($0) }
        _ = browser
        _ = moreGoing
    }

    nonisolated func device(_ device: ICDevice, didCloseSessionWithError error: (any Error)?) {
        hop(device) { self.sessionClosed($0) }
        _ = error
    }

    nonisolated func didRemove(_ device: ICDevice) {
        hop(device) { self.unregister($0) }
    }

    nonisolated func device(_ device: ICDevice, didOpenSessionWithError error: (any Error)?) {
        _ = device
        _ = error
    }

    nonisolated func cameraDevice(_ camera: ICCameraDevice, didAdd items: [ICCameraItem]) {
        _ = camera
        _ = items
    }

    nonisolated func cameraDevice(_ camera: ICCameraDevice, didRemove items: [ICCameraItem]) {
        _ = camera
        _ = items
    }

    nonisolated func cameraDevice(
        _ camera: ICCameraDevice, didReceiveThumbnail thumbnail: CGImage?, for item: ICCameraItem, error: (any Error)?
    ) {
        _ = camera
        _ = thumbnail
        _ = item
        _ = error
    }

    nonisolated func cameraDevice(
        _ camera: ICCameraDevice, didReceiveMetadata metadata: [AnyHashable: Any]?, for item: ICCameraItem,
        error: (any Error)?
    ) {
        _ = camera
        _ = metadata
        _ = item
        _ = error
    }

    nonisolated func cameraDevice(_ camera: ICCameraDevice, didRenameItems items: [ICCameraItem]) {
        _ = camera
        _ = items
    }

    nonisolated func cameraDeviceDidChangeCapability(_ camera: ICCameraDevice) {
        _ = camera
    }

    nonisolated func cameraDevice(_ camera: ICCameraDevice, didReceivePTPEvent eventData: Data) {
        _ = camera
        _ = eventData
    }

    nonisolated func deviceDidBecomeReady(withCompleteContentCatalog device: ICCameraDevice) {
        let raw = Unmanaged.passUnretained(device).toOpaque()
        assumeMain(raw) { pointer in
            let camera = Unmanaged<ICCameraDevice>.fromOpaque(pointer).takeUnretainedValue()
            self.markReady(camera)
        }
    }

    nonisolated func cameraDeviceDidRemoveAccessRestriction(_ device: ICDevice) {
        hop(device) { self.restrict($0, enabled: false) }
    }

    nonisolated func cameraDeviceDidEnableAccessRestriction(_ device: ICDevice) {
        hop(device) { self.restrict($0, enabled: true) }
    }
}

private func hop(_ device: ICDevice, _ body: @MainActor (ICDevice) -> Void) {
    let raw = Unmanaged.passUnretained(device).toOpaque()
    assumeMain(raw) { pointer in
        body(Unmanaged<ICDevice>.fromOpaque(pointer).takeUnretainedValue())
    }
}

/// ImageCaptureCore calls these delegates on the main thread. The pointer is not an object we send.
private func assumeMain(_ raw: UnsafeMutableRawPointer, _ body: @MainActor (UnsafeMutableRawPointer) -> Void) {
    let hop = PointerHop(raw)
    MainActor.assumeIsolated {
        body(hop.raw)
    }
}

private final class PointerHop: @unchecked Sendable {
    let raw: UnsafeMutableRawPointer
    init(_ raw: UnsafeMutableRawPointer) { self.raw = raw }
}
