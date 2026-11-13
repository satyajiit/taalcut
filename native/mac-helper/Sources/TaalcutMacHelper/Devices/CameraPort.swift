// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

protocol DeviceSession: Sendable {
    func start(events: EventPoster) async -> WorkResponse
    func open(handle: String, events: EventPoster) async -> WorkResponse
    func list(handle: String, cursor: Int?, limit: Int, createdFrom: Double?, createdTo: Double?) async -> WorkResponse
    func thumbnail(handle: String, id: String, maxPixel: Int, dest: URL) async -> WorkResponse
    func download(
        handle: String, id: String, destDir: URL, events: EventPoster, progress: @escaping @Sendable (Double) -> Void
    ) async -> WorkResponse
    func cancel(handle: String) async -> WorkResponse
    func close(handle: String) async -> WorkResponse
    func ptp(handle: String, command: Data, outData: Data?) async -> WorkResponse
}

extension DeviceSession {
    func ptp(handle: String, command: Data, outData: Data?) async -> WorkResponse {
        _ = handle
        _ = command
        _ = outData
        return .fail(.unknownMethod("devices.ptp"))
    }
}

func deviceAddedJSON(handle: String, label: String, productKind: String, serial: String?, usbLocation: Int) -> JSONValue {
    let trimmed = serial?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let identity = trimmed.isEmpty ? String(usbLocation) : trimmed
    let platform = (productKind == "iPhone" || productKind == "iPad") ? "ios" : "other"
    return .object([
        "handle": .string(handle),
        "label": .string(label),
        "productKind": .string(productKind),
        "platform": .string(platform),
        "identity": .string(identity),
    ])
}

func localCameraMaskRawValue() -> UInt {
    0x0000_0001 | 0x0000_0100
}
