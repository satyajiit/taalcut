// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

@Suite struct PtpLaneTests {
    @Test func cancelledWaiterDoesNotReleaseThePhysicalCommand() async {
        let lane = PtpLane()
        let first = PtpBox()
        #expect(lane.hold(first))
        let waiter = Task { await first.wait() }
        waiter.cancel()
        guard case .cancelled = await waiter.value else {
            Issue.record("Expected cancelled waiter")
            return
        }
        #expect(lane.busy)
        #expect(!lane.hold(PtpBox()))
        first.finish(Data([1]), Data([2]), nil)
        #expect(lane.hold(PtpBox()))
    }

    @Test func timedOutWaiterWaitsForTheCallbackBeforeItsSuccessorStarts() async {
        let lane = PtpLane()
        let first = PtpBox()
        #expect(lane.hold(first))
        guard case .timedOut = await first.wait(timeout: .milliseconds(1)) else {
            Issue.record("Expected timed-out waiter")
            return
        }
        let second = PtpBox()
        #expect(!lane.hold(second))
        first.finish(Data([1]), Data([2]), nil)
        #expect(lane.hold(second))
        first.finish(nil, nil, NSError(domain: "late-duplicate", code: 1))
        #expect(lane.busy)
        #expect(!lane.hold(PtpBox()))
        #expect(first.poll().dataIn == Data([1]))
        second.finish(Data([3]), Data([4]), nil)
        #expect(!lane.busy)
        #expect(lane.hold(PtpBox()))
    }

    @Test func sessionClosureInvalidatesOldLaneAndItsCallbackCannotAffectReconnection() {
        let oldLane = PtpLane()
        let oldCommand = PtpBox()
        #expect(oldLane.hold(oldCommand))
        oldLane.invalidate()
        let newLane = PtpLane()
        #expect(newLane.hold(PtpBox()))
        oldCommand.finish(nil, nil, nil)
        #expect(!oldLane.hold(PtpBox()))
        #expect(newLane.busy)
        #expect(!newLane.hold(PtpBox()))
    }

    @Test func completedReplyIsReturnedWithoutWaitingForTheTimeout() async {
        let box = PtpBox()
        box.finish(Data([5]), Data([6]), nil)
        guard case .completed(let reply) = await box.wait() else {
            Issue.record("Expected completed reply")
            return
        }
        #expect(reply.dataIn == Data([5]))
        #expect(reply.response == Data([6]))
        #expect(reply.error == nil)
    }
}
