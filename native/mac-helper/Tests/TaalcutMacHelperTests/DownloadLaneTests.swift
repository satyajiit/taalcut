// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import ImageCaptureCore
import Testing

@testable import TaalcutMacHelper

@Suite struct DownloadLaneTests {
    @Test func aFinishedTicketReleasesTheLane() {
        let lane = DownloadLane()
        let first = ticket("1")
        #expect(lane.hold(first))
        #expect(lane.busy)
        #expect(lane.hold(ticket("2")) == false)
        first.finish(filename: "1", error: nil)
        #expect(lane.busy == false)
        let second = ticket("2")
        #expect(lane.hold(second))
        #expect(lane.holds(second))
    }

    @Test func aCancelledDownloadDoesNotBlockTheNext() {
        let lane = DownloadLane()
        let cancelled = ticket("1")
        #expect(lane.hold(cancelled))
        // What abandonDownload does after cancelDownload(): ImageCaptureCore may never call back.
        lane.release(cancelled)
        let next = ticket("2")
        #expect(lane.hold(next))
        // The late completion of the cancelled one changes nothing, and releasing it again is a no-op.
        cancelled.finish(filename: nil, error: NSError(domain: "ICErrorDomain", code: -9937))
        lane.release(cancelled)
        #expect(lane.holds(next))
        #expect(lane.busy)
    }

    @Test func aStalledDownloadTimesOutAndTheNextOneStarts() {
        let start = ContinuousClock.now
        var watch = StallWatch(limit: .seconds(600), now: start)
        let unchanged = watch.note(bytes: 0, at: start)
        #expect(unchanged == false)
        #expect(watch.stalled(at: start + .seconds(599)) == false)
        let moved = watch.note(bytes: 4096, at: start + .seconds(300))
        #expect(moved)
        // Ten minutes in, but bytes moved five minutes ago: still alive.
        #expect(watch.stalled(at: start + .seconds(600)) == false)
        let still = watch.note(bytes: 4096, at: start + .seconds(700))
        #expect(still == false)
        #expect(watch.stalled(at: start + .seconds(900)))

        let lane = DownloadLane()
        let stalled = ticket("1")
        #expect(lane.hold(stalled))
        lane.release(stalled)
        #expect(lane.hold(ticket("2")))
    }

    @Test func progressBelongsToTheHeldTicket() {
        let lane = DownloadLane()
        let held = ticket("1")
        let other = ticket("2")
        #expect(lane.hold(held))
        let progress = Progress(totalUnitCount: 10)
        progress.completedUnitCount = 4
        lane.attach(progress, to: other)
        #expect(lane.bytes(for: held) == (0, 0))
        lane.attach(progress, to: held)
        #expect(lane.bytes(for: held) == (4, 10))
        #expect(lane.bytes(for: other) == (0, 0))
        lane.release(held)
        #expect(lane.bytes(for: held) == (0, 0))
    }

    @Test func theOptionsSentNeverDeleteOrTruncateThePhonesCopy() {
        let folder = URL(fileURLWithPath: "/tmp/staging")
        let plan = DownloadPlan.make(directory: folder, filename: "42")
        let options = plan.options
        #expect(plan.keepsOriginals)
        #expect(options[.deleteAfterSuccessfulDownload] as? Bool == false)
        #expect(options[.truncateAfterSuccessfulDownload] as? Bool == false)
        #expect(options[.overwrite] as? Bool == true)
        #expect(options[.sidecarFiles] as? Bool == true)
        #expect(options[.saveAsFilename] as? String == "42")
        #expect(options[.downloadsDirectoryURL] as? URL == folder)
    }

    @Test func phoneNamesAreReducedToAPlainFileName() {
        #expect(leafName("IMG_0001.HEIC") == "IMG_0001.HEIC")
        #expect(leafName("../../etc/passwd") == "passwd")
        #expect(leafName("DCIM/100APPLE/IMG_0002.MOV") == "IMG_0002.MOV")
        #expect(leafName("..") == nil)
        #expect(leafName(".") == nil)
        #expect(leafName("") == nil)
        #expect(leafName("/") == nil)
    }

    @Test func aSavedFileOutsideTheFolderIsRefused() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let folder = root.appendingPathComponent("item")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let saved = folder.appendingPathComponent("42")
        try Data("x".utf8).write(to: saved)
        let outside = root.appendingPathComponent("other.bin")
        try Data("y".utf8).write(to: outside)
        try FileManager.default.createSymbolicLink(
            at: folder.appendingPathComponent("link"), withDestinationURL: outside)

        #expect(placedFile(folder, filename: "42")?.lastPathComponent == "42")
        #expect(placedFile(folder, filename: saved.path)?.lastPathComponent == "42")
        #expect(placedFile(folder, filename: "../other.bin") == nil)
        #expect(placedFile(folder, filename: outside.path) == nil)
        #expect(placedFile(folder, filename: "link") == nil)
        #expect(placedFile(folder, filename: "/etc/hosts") == nil)
    }

    @Test func deviceEventsArriveInTheOrderTheyWerePosted() async throws {
        let recorder = EventRecorder()
        let poster = EventPoster { _, name, _ in await recorder.add(name) }
        let queue = DeviceEventQueue()
        let names = (0..<100).map { $0.isMultiple(of: 2) ? "device.added.\($0)" : "device.removed.\($0)" }
        for name in names { queue.post(poster, name, .object([:])) }
        let deadline = ContinuousClock.now + .seconds(5)
        while await recorder.count < names.count, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(await recorder.names == names)
    }
}

private func ticket(_ id: String) -> DownloadTicket {
    DownloadTicket(
        id: id, directory: URL(fileURLWithPath: "/tmp"), before: [], presentation: "original", iCloud: false)
}

private func scratch() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-lane-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private actor EventRecorder {
    private(set) var names: [String] = []
    var count: Int { names.count }

    func add(_ name: String) { names.append(name) }
}
