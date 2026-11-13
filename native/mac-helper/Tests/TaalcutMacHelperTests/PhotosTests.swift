// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Photos
import Testing

@testable import TaalcutMacHelper

@Suite struct PhotosTests {
    @Test func listsWithoutRequestingPermissionAndOnlyConnectPrompts() async throws {
        let port = FakePhotosLibrary()
        let service = PhotosService(library: port)
        let confinement = PathConfinement(roots: ["/tmp"])
        for method in ["photos.status", "photos.list", "photos.connect"] {
            let reply = await service.handle(method: method, params: .object([:]), events: .silent, confinement: confinement)
            #expect(reply.failure == nil)
        }
        #expect(await port.calls == ["status", "list", "connect"])
        #expect(HelperService.forMethod("photos.delete") == nil)
        #expect(HelperService.forMethod("photos.export") == .photos)
    }

    @Test func rejectsBadPagesAndCloudWhenLocalOnlyBeforeCallingLibrary() async throws {
        let port = FakePhotosLibrary()
        let service = PhotosService(library: port)
        let root = try photosScratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let confinement = PathConfinement(roots: [root.path])
        for value in [-1.0, 1.5, 501.0] {
            let response = await service.handle(method: "photos.list", params: .object(["limit": .number(value)]), events: .silent, confinement: confinement)
            #expect(response.failure?.code == "helper.bad_request")
        }
        var params = exportParams(root.appendingPathComponent("one.mov"))
        params["allowNetwork"] = .bool(true)
        let cloud = await service.handle(method: "photos.export", params: .object(params), events: .silent, confinement: confinement)
        #expect(cloud.failure?.code == "photos.local_only")
        params["localOnly"] = .bool(false)
        let permitted = await service.handle(method: "photos.export", params: .object(params), events: .silent, confinement: confinement)
        #expect(permitted.failure == nil)
        #expect(await port.selections.first?.allowNetwork == true)
        #expect(await port.calls == ["export"])
    }

    @Test func confinesDestinationsAndNeverOverwritesFiles() async throws {
        let port = FakePhotosLibrary()
        let service = PhotosService(library: port)
        let root = try photosScratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let confinement = PathConfinement(roots: [root.path])
        let existing = root.appendingPathComponent("original.mov")
        try Data("keep".utf8).write(to: existing)
        let present = await service.handle(method: "photos.export", params: .object(exportParams(existing)), events: .silent, confinement: confinement)
        #expect(present.failure?.code == "helper.bad_request")
        let outside = await service.handle(method: "photos.export", params: .object(exportParams(URL(fileURLWithPath: "/etc/photos.mov"))), events: .silent, confinement: confinement)
        #expect(outside.failure?.code == "helper.path_not_allowed")
        #expect(await port.calls.isEmpty)
        #expect(try String(contentsOf: existing, encoding: .utf8) == "keep")
    }

    @Test func onlyOriginalResourceKindsSurvive() {
        for type: PHAssetResourceType in [.photo, .video, .pairedVideo, .alternatePhoto, .audio] {
            #expect(photosIsOriginal(type))
        }
        for type: PHAssetResourceType in [.fullSizePhoto, .fullSizeVideo, .fullSizePairedVideo, .adjustmentData, .adjustmentBasePhoto, .adjustmentBasePairedVideo] {
            #expect(!photosIsOriginal(type))
        }
    }

    @Test func chunkWriterFlushesAndEnforcesReservationWithoutWritingExcess() throws {
        let root = try photosScratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let dest = root.appendingPathComponent("original")
        let writer = try PhotosResourceWriter(dest: dest, limit: 6)
        _ = writer.write(Data("abc".utf8))
        _ = writer.write(Data("def".utf8))
        #expect(try writer.finish(nil, networkAllowed: false).get() == 6)
        #expect(try Data(contentsOf: dest) == Data("abcdef".utf8))
        #expect(throws: (any Error).self) { try PhotosResourceWriter(dest: dest, limit: nil) }
        let limited = root.appendingPathComponent("limited")
        let small = try PhotosResourceWriter(dest: limited, limit: 2)
        _ = small.write(Data("abc".utf8))
        #expect(small.finish(nil, networkAllowed: false) == .failure(.failed("photos.insufficient_space", "Reserved staging space was exhausted", retryable: true)))
        #expect(try Data(contentsOf: limited).isEmpty)
    }

    @Test func cancellationAndCloudFailuresNeverReportSuccess() throws {
        let root = try photosScratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let writer = try PhotosResourceWriter(dest: root.appendingPathComponent("cancel"), limit: nil)
        writer.cancel()
        _ = writer.write(Data("ignored".utf8))
        #expect(writer.finish(nil, networkAllowed: false) == .failure(.cancelled))
        let cloud = try PhotosResourceWriter(dest: root.appendingPathComponent("cloud"), limit: nil)
        let result = cloud.finish(NSError(domain: PHPhotosErrorDomain, code: PHPhotosError.Code.networkAccessRequired.rawValue), networkAllowed: false)
        if case .failure(let error) = result { #expect(error.code == "photos.cloud_required") }
        else { Issue.record("cloud export succeeded unexpectedly") }
    }
}

private func photosScratch() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-photos-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func exportParams(_ dest: URL) -> [String: JSONValue] {
    ["assetId": .string("asset"), "dest": .string(dest.path), "resourceIndex": .number(0), "resourceType": .number(2),
     "originalFilename": .string("one.mov"), "operationId": .string("selected"), "localOnly": .bool(true), "allowNetwork": .bool(false)]
}

private actor FakePhotosLibrary: PhotosLibraryPort {
    var calls: [String] = []
    var selections: [PhotosResourceSelection] = []
    func status() async -> WorkResponse { calls.append("status"); return photosStatus(.notDetermined) }
    func connect() async -> WorkResponse { calls.append("connect"); return photosStatus(.authorized) }
    func list(cursor: Int, limit: Int) async -> WorkResponse {
        calls.append("list")
        return .ok(.object(["items": .array([]), "nextCursor": .null, "total": .number(0)]))
    }
    func thumbnail(assetId: String, dest: URL) async -> WorkResponse {
        calls.append("thumbnail")
        return .ok(.object(["path": .null]))
    }
    func export(_ selection: PhotosResourceSelection, dest: URL, events: EventPoster) async -> WorkResponse {
        calls.append("export")
        selections.append(selection)
        return .ok(.object(["path": .string(dest.path), "bytesWritten": .number(0)]))
    }
}
