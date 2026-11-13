// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

struct PtpReply: Sendable {
    let done: Bool
    let dataIn: Data?
    let response: Data?
    let error: NSError?
}

enum PtpWait: Sendable {
    case completed(PtpReply)
    case cancelled
    case timedOut
}

/// The callback owns completion. Cancelling its waiter cannot cancel ImageCaptureCore's physical command.
final class PtpBox: @unchecked Sendable {
    private let lock = NSLock()
    private var reply = PtpReply(done: false, dataIn: nil, response: nil, error: nil)

    func finish(_ dataIn: Data?, _ response: Data?, _ error: Error?) {
        lock.lock()
        defer { lock.unlock() }
        guard !reply.done else { return }
        reply = PtpReply(done: true, dataIn: dataIn, response: response, error: error as NSError?)
    }

    func poll() -> PtpReply {
        lock.lock()
        defer { lock.unlock() }
        return reply
    }

    func wait(timeout: Duration = .seconds(20)) async -> PtpWait {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if Task.isCancelled { return .cancelled }
            let reply = poll()
            if reply.done { return .completed(reply) }
            do {
                try await Task.sleep(for: .milliseconds(5))
            } catch {
                return .cancelled
            }
        }
        return Task.isCancelled ? .cancelled : .timedOut
    }
}

/// One physical command per camera session. Only main-actor session code changes the owner.
final class PtpLane {
    private var pending: PtpBox?
    private var invalidated = false

    var busy: Bool { pending.map { !$0.poll().done } ?? false }

    func hold(_ next: PtpBox) -> Bool {
        guard !invalidated, !busy else { return false }
        pending = next
        return true
    }

    /// Closing removes the handle before ICC closes; no later command may use this session's lane.
    func invalidate() { invalidated = true }
}
