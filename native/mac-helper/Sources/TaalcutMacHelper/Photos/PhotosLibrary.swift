// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
@preconcurrency import Photos

struct SystemPhotosLibrary: PhotosLibraryPort {
    func status() async -> WorkResponse { photosStatus(PHPhotoLibrary.authorizationStatus(for: .readWrite)) }

    func connect() async -> WorkResponse {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        return photosStatus(status)
    }

    func list(cursor: Int, limit: Int) async -> WorkResponse {
        guard photosCanRead() else { return .fail(photosPermissionDenied) }
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        let assets = PHAsset.fetchAssets(with: options)
        let end = min(assets.count, cursor + limit)
        let items = cursor < end ? (cursor..<end).map { photosAssetJSON(assets.object(at: $0)) } : []
        return .ok(.object([
            "items": .array(items), "total": .number(Double(assets.count)),
            "nextCursor": end < assets.count ? .number(Double(end)) : .null,
        ]))
    }

    func thumbnail(assetId: String, dest: URL) async -> WorkResponse {
        guard photosCanRead() else { return .fail(photosPermissionDenied) }
        guard let asset = photosAsset(assetId) else { return .fail(photosMissing) }
        return await photosThumbnail(asset: asset, dest: dest)
    }

    func export(_ selection: PhotosResourceSelection, dest: URL, events: EventPoster) async -> WorkResponse {
        guard photosCanRead() else { return .fail(photosPermissionDenied) }
        guard let asset = photosAsset(selection.assetId) else { return .fail(photosMissing) }
        let resources = PHAssetResource.assetResources(for: asset)
        guard resources.indices.contains(selection.resourceIndex) else { return .fail(photosChanged) }
        let resource = resources[selection.resourceIndex]
        guard photosIsOriginal(resource.type), resource.type.rawValue == selection.resourceType,
              resource.originalFilename == selection.originalFilename else { return .fail(photosChanged) }
        return await photosExport(resource: resource, selection: selection, dest: dest, events: events)
    }
}

let photosPermissionDenied = HelperFailure.failed("photos.permission_denied", "Photos access is not granted", retryable: false)
let photosMissing = HelperFailure.failed("photos.asset_missing", "Selected Photos asset is no longer available", retryable: true)
let photosChanged = HelperFailure.failed("photos.resource_changed", "Selected original changed; choose it again", retryable: false)

func photosCanRead() -> Bool {
    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    return status == .authorized || status == .limited
}

func photosAsset(_ id: String) -> PHAsset? {
    PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject
}

func photosStatus(_ status: PHAuthorizationStatus) -> WorkResponse {
    let name: String
    switch status {
    case .notDetermined: name = "not_determined"
    case .restricted: name = "restricted"
    case .denied: name = "denied"
    case .authorized: name = "authorized"
    case .limited: name = "limited"
    @unknown default: name = "restricted"
    }
    return .ok(.object(["authorization": .string(name)]))
}

/// Full-size and adjustment resources are edited renditions. Only the original resource family is exported.
func photosIsOriginal(_ type: PHAssetResourceType) -> Bool {
    switch type {
    case .photo, .video, .audio, .alternatePhoto, .pairedVideo: return true
    default: return false
    }
}

func photosAssetJSON(_ asset: PHAsset) -> JSONValue {
    let live = asset.mediaSubtypes.contains(.photoLive)
    let resources = PHAssetResource.assetResources(for: asset).enumerated().compactMap { index, resource -> JSONValue? in
        guard photosIsOriginal(resource.type) else { return nil }
        return .object([
            "index": .number(Double(index)), "type": .number(Double(resource.type.rawValue)),
            "originalFilename": .string(resource.originalFilename), "uti": .string(resource.uniformTypeIdentifier),
            "sizeBytes": .null, "required": .bool(true),
            "role": .string(resource.type == .pairedVideo ? "paired_video" : "original"),
        ])
    }
    var metadata: [String: JSONValue] = [
        "createdAt": asset.creationDate.map { .number(($0.timeIntervalSince1970 * 1000).rounded()) } ?? .null,
        "modifiedAt": asset.modificationDate.map { .number(($0.timeIntervalSince1970 * 1000).rounded()) } ?? .null,
        "width": .number(Double(asset.pixelWidth)), "height": .number(Double(asset.pixelHeight)),
        "favorite": .bool(asset.isFavorite),
    ]
    if let location = asset.location {
        metadata["latitude"] = .number(location.coordinate.latitude)
        metadata["longitude"] = .number(location.coordinate.longitude)
    }
    return .object([
        "id": .string(asset.localIdentifier), "kind": .string(asset.mediaType == .video ? "video" : "photo"),
        "livePhoto": .bool(live), "resources": .array(resources), "photosMetadata": .object(metadata),
    ])
}
