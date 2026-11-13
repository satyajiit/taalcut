// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

struct MediaRecord: Sendable, Equatable {
    var id: String
    var name: String
    var uti: String
    var size: Int64
    var width: Int?
    var height: Int?
    var duration: Double?
    var created: Double?
    var modified: Double?
    var folder: String?
    var relatedUUID: String?
    var groupUUID: String?
    var burstUUID: String?
    var highFramerate: Bool
    var timeLapse: Bool
    var sidecars: [String]
    var wasAddedAfterCatalog: Bool

    var json: JSONValue {
        var body: [String: JSONValue] = [
            "id": .string(id),
            "name": .string(name),
            "uti": .string(uti),
            "size": .number(Double(size)),
            "highFramerate": .bool(highFramerate),
            "timeLapse": .bool(timeLapse),
            "sidecars": .array(sidecars.map { .string($0) }),
            "wasAddedAfterCatalog": .bool(wasAddedAfterCatalog),
        ]
        put(&body, "width", width)
        put(&body, "height", height)
        put(&body, "duration", duration)
        put(&body, "created", created)
        put(&body, "modified", modified)
        put(&body, "folder", folder)
        put(&body, "relatedUUID", relatedUUID)
        put(&body, "groupUUID", groupUUID)
        put(&body, "burstUUID", burstUUID)
        return .object(body)
    }
}

struct ItemPage: Sendable, Equatable {
    var items: [MediaRecord]
    var nextCursor: Int?
}

func coarseMediaKind(uti raw: String) -> String {
    let value = raw.lowercased()
    if value.contains("audio") { return "audio" }
    if value.contains("image") || value.contains("heic") || value.contains("heif") || value.contains("jpeg")
        || value.contains("png") || value.contains("raw") || value.contains("tiff")
    {
        return "image"
    }
    if value.contains("movie") || value.contains("video") || value.contains("mpeg") || value.contains("quicktime") {
        return "movie"
    }
    return "data"
}

func pageItems(
    _ items: [MediaRecord], cursor: Int, limit: Int, createdFrom: Double?, createdTo: Double?
) -> ItemPage {
    let filtered = items.filter { item in
        guard createdFrom != nil || createdTo != nil else { return true }
        guard let created = item.created else { return false }
        if let createdFrom, created < createdFrom { return false }
        if let createdTo, created > createdTo { return false }
        return true
    }
    let start = min(max(cursor, 0), filtered.count)
    let end = min(start + max(limit, 0), filtered.count)
    let next = end < filtered.count ? end : nil
    return ItemPage(items: Array(filtered[start..<end]), nextCursor: next)
}

func itemPageJSON(_ page: ItemPage) -> JSONValue {
    var body: [String: JSONValue] = ["items": .array(page.items.map(\.json))]
    if let next = page.nextCursor {
        body["nextCursor"] = .number(Double(next))
    }
    return .object(body)
}

private func put(_ body: inout [String: JSONValue], _ key: String, _ value: String?) {
    if let value, !value.isEmpty { body[key] = .string(value) }
}

private func put(_ body: inout [String: JSONValue], _ key: String, _ value: Double?) {
    if let value { body[key] = .number(value) }
}

private func put(_ body: inout [String: JSONValue], _ key: String, _ value: Int?) {
    if let value { body[key] = .number(Double(value)) }
}
