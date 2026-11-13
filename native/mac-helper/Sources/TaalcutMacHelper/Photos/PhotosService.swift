// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

protocol PhotosLibraryPort: Sendable {
    func status() async -> WorkResponse
    func connect() async -> WorkResponse
    func list(cursor: Int, limit: Int) async -> WorkResponse
    func thumbnail(assetId: String, dest: URL) async -> WorkResponse
    func export(_ selection: PhotosResourceSelection, dest: URL, events: EventPoster) async -> WorkResponse
}

struct PhotosResourceSelection: Sendable {
    let assetId: String
    let resourceIndex: Int
    let originalFilename: String
    let resourceType: Int
    let allowNetwork: Bool
    let byteLimit: Int64?
    let operationId: String
}

/// Only connect may ask for access. Listing, thumbnails and exports fail closed after permission loss.
struct PhotosService: Sendable {
    let library: any PhotosLibraryPort

    init(library: any PhotosLibraryPort = SystemPhotosLibrary()) { self.library = library }

    func handle(method: String, params: JSONValue, events: EventPoster, confinement: PathConfinement) async -> WorkResponse {
        switch method {
        case "photos.status": return await library.status()
        case "photos.connect": return await library.connect()
        case "photos.list":
            guard let cursor = photosWhole(params, "cursor", defaulted: 0), cursor >= 0,
                  let limit = photosWhole(params, "limit", defaulted: 100), (1...500).contains(limit)
            else { return .fail(.badRequest("invalid Photos page")) }
            return await library.list(cursor: cursor, limit: limit)
        case "photos.thumbnail", "photos.export":
            guard let assetId = params.key("assetId")?.string, !assetId.isEmpty,
                  let path = params.key("dest")?.string else { return .fail(.badRequest("assetId and dest are required")) }
            let dest: URL
            switch confinement.resolve(path) {
            case .failure(let error): return .fail(error)
            case .success(let url): dest = url
            }
            guard FileManager.default.fileExists(atPath: dest.deletingLastPathComponent().path),
                  !FileManager.default.fileExists(atPath: dest.path) else {
                return .fail(.badRequest("destination must be new, in an existing directory"))
            }
            if method == "photos.thumbnail" { return await library.thumbnail(assetId: assetId, dest: dest) }
            return await export(params, assetId: assetId, dest: dest, events: events)
        default: return .fail(.unknownMethod(method))
        }
    }

    private func export(_ params: JSONValue, assetId: String, dest: URL, events: EventPoster) async -> WorkResponse {
        guard let index = photosWhole(params, "resourceIndex"), index >= 0,
              let kind = photosWhole(params, "resourceType"),
              let name = params.key("originalFilename")?.string, !name.isEmpty,
              let operation = params.key("operationId")?.string, !operation.isEmpty,
              let localOnly = params.key("localOnly")?.bool,
              let allowNetwork = params.key("allowNetwork")?.bool else {
            return .fail(.badRequest("selected resource and network policy are required"))
        }
        guard !(allowNetwork && localOnly) else {
            return .fail(.failed("photos.local_only", "iCloud download is disabled in Local only mode", retryable: false))
        }
        var byteLimit: Int64?
        if let value = params.key("byteLimit"), value != .null {
            guard let limit = photosWhole(params, "byteLimit"), limit >= 0 else {
                return .fail(.badRequest("byteLimit must be a nonnegative whole number"))
            }
            byteLimit = Int64(limit)
        }
        let selection = PhotosResourceSelection(
            assetId: assetId, resourceIndex: index, originalFilename: name, resourceType: kind,
            allowNetwork: allowNetwork, byteLimit: byteLimit, operationId: operation)
        return await library.export(selection, dest: dest, events: events)
    }
}

func photosWhole(_ params: JSONValue, _ key: String, defaulted: Int? = nil) -> Int? {
    guard let value = params.key(key) else { return defaulted }
    guard let number = value.number, number.isFinite, number.rounded() == number,
          number >= 0, number <= 9_007_199_254_740_991 else { return nil }
    return Int(number)
}
