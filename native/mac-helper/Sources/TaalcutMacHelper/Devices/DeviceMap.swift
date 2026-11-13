// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import ImageCaptureCore

func mediaRecords(camera: ICCameraDevice, minted: inout [ObjectIdentifier: String]) -> [MediaRecord] {
    var records: [MediaRecord] = []
    for item in camera.mediaFiles ?? [] {
        guard let file = item as? ICCameraFile else { continue }
        records.append(mediaRecord(file, minted: &minted))
    }
    return records
}

func mediaRecord(_ file: ICCameraFile, minted: inout [ObjectIdentifier: String]) -> MediaRecord {
    let width = file.width > 0 ? Int(file.width) : nil
    let height = file.height > 0 ? Int(file.height) : nil
    let duration = file.duration > 0 ? file.duration : nil
    let sidecars = (file.sidecarFiles ?? []).compactMap { item -> String? in
        guard let name = item.name, !name.isEmpty else { return nil }
        return name
    }
    return MediaRecord(
        id: stableFileID(file, minted: &minted),
        name: file.originalFilename ?? file.name ?? "",
        uti: coarseMediaKind(uti: file.uti ?? ""),
        size: Int64(file.fileSize),
        width: width,
        height: height,
        duration: duration,
        created: epochMillis(file.exifCreationDate ?? file.creationDate ?? file.fileCreationDate),
        modified: epochMillis(file.fileModificationDate ?? file.modificationDate),
        folder: folderPath(file),
        relatedUUID: file.relatedUUID,
        groupUUID: file.groupUUID,
        burstUUID: file.burstUUID,
        highFramerate: file.highFramerate,
        timeLapse: file.timeLapse,
        sidecars: sidecars,
        wasAddedAfterCatalog: file.wasAddedAfterContentCatalogCompleted)
}

func findCameraFile(_ id: String, camera: ICCameraDevice, minted: inout [ObjectIdentifier: String]) -> ICCameraFile? {
    for item in camera.mediaFiles ?? [] {
        guard let file = item as? ICCameraFile else { continue }
        if stableFileID(file, minted: &minted) == id { return file }
    }
    return nil
}

func directoryNames(_ url: URL) -> Set<String> {
    Set((try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? [])
}

private func stableFileID(_ file: ICCameraFile, minted: inout [ObjectIdentifier: String]) -> String {
    if file.ptpObjectHandle != 0 { return String(file.ptpObjectHandle) }
    let key = ObjectIdentifier(file)
    if let existing = minted[key] { return existing }
    let created = UUID().uuidString
    minted[key] = created
    return created
}

private func epochMillis(_ date: Date?) -> Double? {
    guard let date else { return nil }
    return date.timeIntervalSince1970 * 1000
}

private func folderPath(_ item: ICCameraItem) -> String? {
    var names: [String] = []
    var folder = item.parentFolder
    var depth = 0
    while let current = folder, depth < 64 {
        if let name = current.name, !name.isEmpty { names.append(name) }
        folder = current.parentFolder
        depth += 1
    }
    guard !names.isEmpty else { return nil }
    return names.reversed().joined(separator: "/")
}
