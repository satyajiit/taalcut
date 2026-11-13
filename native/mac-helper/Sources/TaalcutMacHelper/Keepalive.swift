// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// OCR v2 (FIX-OCRCOLD): a `progress` line for every live OCR request each `interval`, from the moment it arrives
/// until its response, with its stage (`queued` for a slot, `running`) and the share of its images read.
///
/// Apple Vision compiles its models for the Neural Engine the first time a helper build runs them, which took 65 s to
/// over 3 minutes on a busy Mac. These lines tell the client the process is alive and still on the request, so it
/// waits instead of cancelling at a fixed timeout. A cancel ends the request and every compile still ahead of it.
/// The beat runs on its own dispatch timer, off the cooperative pool that Vision's work may be holding.
final class Keepalive: @unchecked Sendable {
    private struct Live {
        var stage: String
        var fraction: Double
    }

    private let lock = NSLock()
    private var live: [String: Live] = [:]
    private let sink: @Sendable (Outbound) -> Void
    private let timer: DispatchSourceTimer

    init(interval: Double, sink: @escaping @Sendable (Outbound) -> Void) {
        self.sink = sink
        timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "taalcut.mac-helper.keepalive", qos: .userInitiated))
        timer.schedule(deadline: .now() + interval, repeating: interval, leeway: .milliseconds(100))
        timer.setEventHandler { [weak self] in self?.beat() }
        timer.resume()
    }

    deinit {
        timer.cancel()
    }

    func begin(_ id: String, stage: String) {
        update(id) { $0 = Live(stage: stage, fraction: 0) }
    }

    func stage(_ id: String, _ stage: String) {
        update(id) { $0?.stage = stage }
    }

    func fraction(_ id: String, _ fraction: Double) {
        update(id) { $0?.fraction = fraction }
    }

    func end(_ id: String) {
        update(id) { $0 = nil }
    }

    var ids: [String] {
        lock.lock()
        defer { lock.unlock() }
        return Array(live.keys)
    }

    private func update(_ id: String, _ change: (inout Live?) -> Void) {
        lock.lock()
        change(&live[id])
        lock.unlock()
    }

    private func beat() {
        lock.lock()
        let snapshot = live
        lock.unlock()
        for (id, state) in snapshot.sorted(by: { $0.key < $1.key }) {
            sink(.progress(id: id, fraction: state.fraction, stage: state.stage))
        }
    }
}
