// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// One ImageCaptureCore download. Its completion arrives on any thread.
final class DownloadTicket: @unchecked Sendable {
    let id: String
    let directory: URL
    let before: Set<String>
    let presentation: String
    let iCloud: Bool
    private let lock = NSLock()
    private var arrived = false
    private var filename: String?
    private var error: NSError?

    init(id: String, directory: URL, before: Set<String>, presentation: String, iCloud: Bool) {
        self.id = id
        self.directory = directory
        self.before = before
        self.presentation = presentation
        self.iCloud = iCloud
    }

    func finish(filename: String?, error: Error?) {
        lock.lock()
        self.filename = filename
        self.error = error as NSError?
        arrived = true
        lock.unlock()
    }

    func poll() -> (done: Bool, filename: String?, error: NSError?) {
        lock.lock()
        defer { lock.unlock() }
        return (arrived, filename, error)
    }
}

/// The one download a camera runs at a time, with its byte progress. A finished ticket no longer
/// holds the lane, and a cancelled or stalled one is released at once, so the next item never
/// waits on a download nobody polls any more. Used only on the main actor (it lives in a camera slot).
final class DownloadLane {
    private(set) var ticket: DownloadTicket?
    private var progress: Progress?

    /// True while the held ticket has not finished.
    var busy: Bool {
        guard let ticket else { return false }
        return !ticket.poll().done
    }

    func holds(_ candidate: DownloadTicket) -> Bool { ticket === candidate }

    /// Takes the lane for a new download. False while another download is still running.
    func hold(_ next: DownloadTicket) -> Bool {
        if busy { return false }
        ticket = next
        progress = nil
        return true
    }

    /// The progress ImageCaptureCore returned for the held ticket.
    func attach(_ value: Progress?, to owner: DownloadTicket) {
        guard holds(owner) else { return }
        progress = value
    }

    func bytes(for owner: DownloadTicket) -> (completed: Int64, total: Int64) {
        guard holds(owner), let progress else { return (0, 0) }
        return (progress.completedUnitCount, progress.totalUnitCount)
    }

    func release(_ owner: DownloadTicket) {
        guard holds(owner) else { return }
        ticket = nil
        progress = nil
    }
}

/// A download fails when its byte count has not moved for `limit`, however long it has run, so a
/// large ProRes clip over a slow cable is never cut short while bytes still arrive.
struct StallWatch: Sendable {
    let limit: Duration
    private var bytes: Int64 = 0
    private var since: ContinuousClock.Instant

    init(limit: Duration, now: ContinuousClock.Instant) {
        self.limit = limit
        since = now
    }

    /// True when the byte count moved since the last note.
    mutating func note(bytes next: Int64, at now: ContinuousClock.Instant) -> Bool {
        guard next != bytes else { return false }
        bytes = next
        since = now
        return true
    }

    func stalled(at now: ContinuousClock.Instant) -> Bool { now - since >= limit }
}

/// No byte progress for this long ends a download (`devices.download_failed`, retryable).
let downloadStallLimit: Duration = .seconds(10 * 60)
