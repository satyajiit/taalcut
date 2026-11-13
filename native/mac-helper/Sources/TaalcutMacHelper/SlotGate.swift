// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// CheckedContinuation is not Sendable. The box hops it onto the actor.
final class ContinuationBox: @unchecked Sendable {
    let continuation: CheckedContinuation<Void, Error>
    init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }
}

/// A small async semaphore, one per service (`HelperService.slots`). Cancelling a waiter resumes it with
/// `CancellationError` instead of leaving it in the queue. The bookkeeping is `SlotQueue`'s.
actor SlotGate {
    private var queue: SlotQueue<ContinuationBox>

    init(limit: Int) { queue = SlotQueue(limit: limit) }

    func acquire() async throws {
        try Task.checkCancellation()
        if queue.take() { return }
        let token = queue.expect()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let box = ContinuationBox(continuation)
                Task { await self.arrive(token, box) }
            }
        } onCancel: {
            Task { await self.cancel(token) }
        }
    }

    func release() {
        queue.release()?.continuation.resume()
    }

    private func arrive(_ token: UUID, _ box: ContinuationBox) {
        switch queue.arrive(token, box) {
        case .slot: box.continuation.resume()
        case .cancelled: box.continuation.resume(throwing: CancellationError())
        case .waiting: break
        }
    }

    private func cancel(_ token: UUID) {
        queue.cancel(token)?.continuation.resume(throwing: CancellationError())
    }
}

/// A `SlotGate`'s slots and waiters, without the waiting (IX2-F5). A waiter is expected before it suspends and
/// arrives after (the continuation hops onto the actor), so other calls can come between the two: a release in that
/// gap leaves the slot free and the waiter takes it when it arrives, and a cancel in that gap fails it when it
/// arrives. Waiters get slots in the order they arrived.
struct SlotQueue<Waiter> {
    enum Arrival: Equatable { case slot, cancelled, waiting }

    private(set) var free: Int
    private var waiting: [(token: UUID, waiter: Waiter)] = []
    /// Expected waiters that haven't arrived, and whether each was cancelled meanwhile.
    private var expected: [UUID: Bool] = [:]

    init(limit: Int) { free = limit }

    /// Waiters holding no slot yet, arrived or not.
    var waiters: Int { waiting.count + expected.count }

    /// Takes a free slot now, or says there is none.
    mutating func take() -> Bool {
        guard free > 0 else { return false }
        free -= 1
        return true
    }

    /// A waiter that will arrive.
    mutating func expect() -> UUID {
        let token = UUID()
        expected[token] = false
        return token
    }

    /// The expected waiter arrived: it has a slot (one came free meanwhile), was cancelled meanwhile, or waits.
    mutating func arrive(_ token: UUID, _ waiter: Waiter) -> Arrival {
        if expected.removeValue(forKey: token) == true { return .cancelled }
        if take() { return .slot }
        waiting.append((token, waiter))
        return .waiting
    }

    /// A released slot: the longest-waiting waiter's to resume, or free again when nobody waits.
    mutating func release() -> Waiter? {
        if waiting.isEmpty {
            free += 1
            return nil
        }
        return waiting.removeFirst().waiter
    }

    /// A cancelled waiter: returned when it was waiting (to fail it now), remembered when it hasn't arrived, and
    /// forgotten when it already has its slot (its holder releases it).
    mutating func cancel(_ token: UUID) -> Waiter? {
        if let index = waiting.firstIndex(where: { $0.token == token }) {
            return waiting.remove(at: index).waiter
        }
        if expected[token] != nil { expected[token] = true }
        return nil
    }
}
