// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

@testable import TaalcutMacHelper

/// What a session wrote, for the protocol and keepalive tests.
final class Inbox: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [Outbound] = []

    func append(_ item: Outbound) {
        lock.lock()
        items.append(item)
        lock.unlock()
    }

    func snapshot() -> [Outbound] {
        lock.lock()
        defer { lock.unlock() }
        return items
    }

    func waitFor(_ count: Int) async -> [Outbound] {
        let deadline = ContinuousClock.now + .seconds(5)
        while ContinuousClock.now < deadline {
            let current = snapshot()
            if current.count >= count { return current }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return snapshot()
    }
}

actor Latch {
    private var opened = false

    func waitUntilOpen() async {
        while !opened {
            if Task.isCancelled { return }
            try? await Task.sleep(for: .milliseconds(15))
        }
    }

    func open() { opened = true }
}

func request(_ id: String, _ method: String) -> String {
    #"{"id":"\#(id)","method":"\#(method)","params":{},"type":"request"}"#
}

actor Flag {
    var isSet = false
    func mark() { isSet = true }
}
