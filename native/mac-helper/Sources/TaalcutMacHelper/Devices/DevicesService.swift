// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

actor DevicesService {
    private var injected: (any DeviceSession)?
    private var live: (any DeviceSession)?

    init() {}

    init(session: any DeviceSession) {
        injected = session
    }

    func handle(
        method: String, params: JSONValue, progress: @escaping @Sendable (Double) -> Void,
        events: EventPoster, confinement: PathConfinement
    ) async -> WorkResponse {
        let backend = await session()
        switch method {
        case "devices.start":
            return await backend.start(events: events)
        case "devices.open":
            guard let handle = text(params, "handle") else { return .fail(.badRequest("handle is required")) }
            return await backend.open(handle: handle, events: events)
        case "devices.list":
            return await list(params, backend: backend)
        case "devices.thumbnail":
            return await thumbnail(params, backend: backend, confinement: confinement)
        case "devices.download":
            return await download(params, backend: backend, progress: progress, events: events, confinement: confinement)
        case "devices.cancel":
            guard let handle = text(params, "handle") else { return .fail(.badRequest("handle is required")) }
            return await backend.cancel(handle: handle)
        case "devices.close":
            guard let handle = text(params, "handle") else { return .fail(.badRequest("handle is required")) }
            return await backend.close(handle: handle)
        case "devices.ptp":
            return await ptp(params, backend: backend)
        default:
            return .fail(.unknownMethod(method))
        }
    }

    private func session() async -> any DeviceSession {
        if let injected { return injected }
        if let live { return live }
        let created = await MainActor.run { LiveDeviceSession() }
        live = created
        return created
    }

    private func list(_ params: JSONValue, backend: any DeviceSession) async -> WorkResponse {
        guard let handle = text(params, "handle") else { return .fail(.badRequest("handle is required")) }
        let limit: Int
        switch whole(params.key("limit"), name: "limit", defaulted: 100) {
        case .failure(let failure): return .fail(failure)
        case .success(let value): limit = value
        }
        guard (1...500).contains(limit) else { return .fail(.badRequest("limit must be from 1 to 500")) }
        let cursor: Int
        switch whole(params.key("cursor"), name: "cursor", defaulted: 0) {
        case .failure(let failure): return .fail(failure)
        case .success(let value): cursor = value
        }
        guard cursor >= 0 else { return .fail(.badRequest("cursor must be zero or more")) }
        let createdFrom: Double?
        switch optionalNumber(params, "createdFrom") {
        case .failure(let failure): return .fail(failure)
        case .success(let value): createdFrom = value
        }
        let createdTo: Double?
        switch optionalNumber(params, "createdTo") {
        case .failure(let failure): return .fail(failure)
        case .success(let value): createdTo = value
        }
        return await backend.list(
            handle: handle, cursor: cursor, limit: limit, createdFrom: createdFrom, createdTo: createdTo)
    }

    private func thumbnail(
        _ params: JSONValue, backend: any DeviceSession, confinement: PathConfinement
    ) async -> WorkResponse {
        guard let handle = text(params, "handle"), let id = text(params, "id"), let dest = text(params, "dest") else {
            return .fail(.badRequest("handle, id and dest are required"))
        }
        let maxPixel: Int
        switch whole(params.key("maxPixel"), name: "maxPixel", defaulted: nil) {
        case .failure(let failure): return .fail(failure)
        case .success(let value): maxPixel = value
        }
        guard (1...256).contains(maxPixel) else { return .fail(.badRequest("maxPixel must be from 1 to 256")) }
        switch existingParent(dest, confinement: confinement) {
        case .failure(let failure): return .fail(failure)
        case .success(let url):
            return await backend.thumbnail(handle: handle, id: id, maxPixel: maxPixel, dest: url)
        }
    }

    private func download(
        _ params: JSONValue, backend: any DeviceSession, progress: @escaping @Sendable (Double) -> Void,
        events: EventPoster, confinement: PathConfinement
    ) async -> WorkResponse {
        guard let handle = text(params, "handle"), let id = text(params, "id"), let destDir = text(params, "destDir") else {
            return .fail(.badRequest("handle, id and destDir are required"))
        }
        switch directory(destDir, confinement: confinement) {
        case .failure(let failure): return .fail(failure)
        case .success(let url):
            return await backend.download(
                handle: handle, id: id, destDir: url, events: events, progress: progress)
        }
    }

    private func ptp(_ params: JSONValue, backend: any DeviceSession) async -> WorkResponse {
        guard let handle = text(params, "handle"), let rawCommand = text(params, "command"),
            let command = Data(base64Encoded: rawCommand), command.count >= 12
        else {
            return .fail(.badRequest("handle and base64 command are required"))
        }
        var outData: Data?
        if let rawOut = params.key("data")?.string, !rawOut.isEmpty {
            guard let decoded = Data(base64Encoded: rawOut) else {
                return .fail(.badRequest("data must be base64"))
            }
            outData = decoded
        }
        return await backend.ptp(handle: handle, command: command, outData: outData)
    }
}

private func text(_ params: JSONValue, _ name: String) -> String? {
    guard let value = params.key(name)?.string, !value.isEmpty else { return nil }
    return value
}

private func whole(_ value: JSONValue?, name: String, defaulted: Int?) -> Result<Int, HelperFailure> {
    guard let value else {
        if let defaulted { return .success(defaulted) }
        return .failure(.badRequest("\(name) is required"))
    }
    guard let number = value.number, number.isFinite, number.rounded() == number,
        number >= Double(Int.min), number <= Double(Int.max)
    else { return .failure(.badRequest("\(name) must be an integer")) }
    return .success(Int(number))
}

private func optionalNumber(_ params: JSONValue, _ name: String) -> Result<Double?, HelperFailure> {
    guard let value = params.key(name) else { return .success(nil) }
    guard let number = value.number, number.isFinite else { return .failure(.badRequest("\(name) must be a number")) }
    return .success(number)
}

private func directory(_ path: String, confinement: PathConfinement) -> Result<URL, HelperFailure> {
    switch confinement.resolve(path) {
    case .failure(let failure): return .failure(failure)
    case .success(let url):
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return .failure(.badRequest("destDir is not a directory"))
        }
        return .success(url)
    }
}

private func existingParent(_ path: String, confinement: PathConfinement) -> Result<URL, HelperFailure> {
    switch confinement.resolve(path) {
    case .failure(let failure): return .failure(failure)
    case .success(let url):
        var isDirectory: ObjCBool = false
        let parent = url.deletingLastPathComponent().path
        guard FileManager.default.fileExists(atPath: parent, isDirectory: &isDirectory), isDirectory.boolValue else {
            return .failure(.badRequest("dest parent does not exist"))
        }
        return .success(url)
    }
}
