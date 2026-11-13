// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

enum DeviceAccessState: String, Sendable {
    case locked
    case ready
    case notTrusted = "not-trusted"
    case busy
}

struct AccessReading: Sendable, Equatable {
    var state: DeviceAccessState
    var holder: String?
}

enum AccessSignal: Sendable {
    case restricted
    case restrictionEnabled
    case catalogueReady(sessionOpen: Bool, catalogueComplete: Bool, restricted: Bool)
    case errorCode(Int)
}

func accessReading(_ signal: AccessSignal) -> AccessReading {
    switch signal {
    case .restricted, .restrictionEnabled:
        return AccessReading(state: .locked, holder: nil)
    case .catalogueReady(let sessionOpen, let catalogueComplete, let restricted):
        if restricted { return AccessReading(state: .locked, holder: nil) }
        if sessionOpen && catalogueComplete { return AccessReading(state: .ready, holder: nil) }
        return AccessReading(state: .locked, holder: nil)
    case .errorCode(let code):
        switch code {
        case -9943:
            return AccessReading(state: .locked, holder: nil)
        case -9951:
            return AccessReading(state: .notTrusted, holder: nil)
        case -21343, -9927:
            return AccessReading(state: .busy, holder: "camera-agent")
        default:
            return AccessReading(state: .locked, holder: nil)
        }
    }
}

func deviceDetail(domain: String, code: Int, iCloud: Bool?, bytesWritten: Int64?) -> JSONValue {
    .object([
        "domain": .string(domain),
        "code": .number(Double(code)),
        "iCloudPhotosEnabled": iCloud.map { .bool($0) } ?? .null,
        "bytesWritten": bytesWritten.map { .number(Double($0)) } ?? .null,
    ])
}

func deviceFailure(code: Int, domain: String, iCloud: Bool?, bytesWritten: Int64?) -> HelperFailure {
    let detail = deviceDetail(domain: domain, code: code, iCloud: iCloud, bytesWritten: bytesWritten)
    switch code {
    case -9943:
        return .failed("devices.locked", "device is locked", retryable: false, detail: detail)
    case -9951:
        return .failed("devices.not_trusted", "trust this computer is pending", retryable: false, detail: detail)
    case -21447:
        return .failed("devices.item_empty", "object data is empty", retryable: false, detail: detail)
    case -9934:
        return .failed("devices.download_failed", "download failed", retryable: true, detail: detail)
    case -9937:
        return .failed("devices.download_cancelled", "download cancelled", retryable: false, detail: detail)
    case -21343, -9927:
        return .failed("devices.session_failed", "camera is busy", retryable: true, detail: detail)
    default:
        return .failed("devices.session_failed", "image capture failed", retryable: true, detail: detail)
    }
}

func emptyItemFailure(domain: String, code: Int, iCloud: Bool?, bytesWritten: Int64) -> HelperFailure {
    if code == -9934 || code == -9937 || code == -9943 || code == -9951 || code == -21343 || code == -9927 {
        return deviceFailure(code: code, domain: domain, iCloud: iCloud, bytesWritten: bytesWritten)
    }
    let detail = deviceDetail(domain: domain, code: code, iCloud: iCloud, bytesWritten: bytesWritten)
    return .failed("devices.item_empty", "object data is empty", retryable: false, detail: detail)
}

func deviceNotFound(handle: String) -> HelperFailure {
    .failed(
        "devices.not_found", handle, retryable: false,
        detail: deviceDetail(domain: "ICErrorDomain", code: 0, iCloud: nil, bytesWritten: nil))
}

func catalogTimeout(iCloud: Bool?) -> HelperFailure {
    .failed(
        "devices.catalog_timeout", "content catalogue timed out", retryable: true,
        detail: deviceDetail(domain: "ICErrorDomain", code: 0, iCloud: iCloud, bytesWritten: nil))
}

func accessEventJSON(handle: String, reading: AccessReading) -> JSONValue {
    var body: [String: JSONValue] = [
        "handle": .string(handle),
        "state": .string(reading.state.rawValue),
    ]
    if let holder = reading.holder { body["holder"] = .string(holder) }
    return .object(body)
}

func sessionNotReady(iCloud: Bool?) -> HelperFailure {
    .failed(
        "devices.session_failed", "content catalogue is not complete", retryable: true,
        detail: deviceDetail(domain: "ICErrorDomain", code: 0, iCloud: iCloud, bytesWritten: nil))
}
