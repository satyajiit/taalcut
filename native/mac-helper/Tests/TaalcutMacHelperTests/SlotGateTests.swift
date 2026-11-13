// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

/// IX2-F5: the gate's bookkeeping in the orders the actor can't pin down (a release or a cancel between a waiter
/// suspending and arriving), and the gate itself under real tasks. `#expect` can't call a mutating method, so each
/// step's answer is taken first.
@Suite struct SlotGateTests {
    @Test func aSlotReleasedBeforeTheWaiterArrivesIsTakenOnArrival() {
        var queue = SlotQueue<String>(limit: 1)
        let held = queue.take()
        let token = queue.expect()
        // The holder releases in the gap: nobody has arrived to hand the slot to, so it goes back to free.
        let handedTo = queue.release()
        let freeInTheGap = queue.free
        // The waiter arrives and takes it, instead of waiting for a release that already happened.
        let arrival = queue.arrive(token, "late")
        #expect(held)
        #expect(handedTo == nil)
        #expect(freeInTheGap == 1)
        #expect(arrival == .slot)
        #expect(queue.free == 0)
        #expect(queue.waiters == 0)
    }

    @Test func waitersGetSlotsInTheOrderTheyArrived() {
        var queue = SlotQueue<String>(limit: 1)
        _ = queue.take()
        var arrivals: [SlotQueue<String>.Arrival] = []
        for name in ["first", "second", "third"] {
            let token = queue.expect()
            arrivals.append(queue.arrive(token, name))
        }
        var handedTo: [String?] = []
        for _ in 0..<4 { handedTo.append(queue.release()) }
        #expect(arrivals == [.waiting, .waiting, .waiting])
        #expect(handedTo == ["first", "second", "third", nil])
        #expect(queue.free == 1)
    }

    @Test func aCancelBeforeArrivalFailsTheWaiterWhenItArrives() {
        var queue = SlotQueue<String>(limit: 1)
        _ = queue.take()
        let token = queue.expect()
        let failedNow = queue.cancel(token)
        _ = queue.release()
        // A slot is free, but the waiter was cancelled: it fails and leaves the slot free.
        let arrival = queue.arrive(token, "gone")
        #expect(failedNow == nil)
        #expect(arrival == .cancelled)
        #expect(queue.free == 1)
        #expect(queue.waiters == 0)
    }

    @Test func aCancelWhileWaitingHandsTheNextReleaseToTheNextWaiter() {
        var queue = SlotQueue<String>(limit: 1)
        _ = queue.take()
        let first = queue.expect()
        _ = queue.arrive(first, "first")
        let second = queue.expect()
        _ = queue.arrive(second, "second")
        let failedNow = queue.cancel(first)
        let handedTo = queue.release()
        #expect(failedNow == "first")
        #expect(handedTo == "second")
    }

    @Test func aCancelAfterTheSlotWasGivenIsForgotten() {
        var queue = SlotQueue<String>(limit: 1)
        _ = queue.take()
        let token = queue.expect()
        _ = queue.arrive(token, "holder")
        let handedTo = queue.release()
        let failedNow = queue.cancel(token)
        let waitersAfter = queue.waiters
        let lastRelease = queue.release()
        #expect(handedTo == "holder")
        #expect(failedNow == nil)
        #expect(waitersAfter == 0)
        #expect(lastRelease == nil)
        #expect(queue.free == 1)
    }

    @Test(.timeLimit(.minutes(1))) func everyWaiterGetsASlotUnderContention() async throws {
        let gate = SlotGate(limit: 2)
        let finished = try await withThrowingTaskGroup(of: Int.self) { group in
            for _ in 0..<400 {
                group.addTask {
                    try await gate.acquire()
                    await Task.yield()
                    await gate.release()
                    return 1
                }
            }
            return try await group.reduce(0, +)
        }
        #expect(finished == 400)
        // Both slots are free again.
        try await gate.acquire()
        try await gate.acquire()
    }

    @Test(.timeLimit(.minutes(1))) func aCancelledWaiterFailsAndKeepsNoSlot() async throws {
        let gate = SlotGate(limit: 1)
        try await gate.acquire()
        let waiter = Task { try await gate.acquire() }
        try await Task.sleep(for: .milliseconds(20))
        waiter.cancel()
        await #expect(throws: CancellationError.self) { try await waiter.value }
        await gate.release()
        try await gate.acquire()
    }
}
