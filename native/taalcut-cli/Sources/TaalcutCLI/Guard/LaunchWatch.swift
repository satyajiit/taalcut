// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/// Decides, from what the guard sees on each poll, whether the new version is healthy, failed twice, or hung.
/// A launch is a process of the app's executable or a step of `launchAttempts` (a crash between two polls).
struct LaunchWatch {
    enum Verdict: Equatable {
        case keepWatching
        case healthy
        case failedLaunches(Int)
        case hung(Int32)
    }

    let healthTimeoutMs: Double
    private var firstSeen: [Int32: Double] = [:]

    init(healthTimeoutMs: Double) {
        self.healthTimeoutMs = healthTimeoutMs
    }

    mutating func observe(nowMs: Double, running: [Int32], attempts: Int, healthy: Bool) -> Verdict {
        if healthy { return .healthy }
        for pid in running where firstSeen[pid] == nil { firstSeen[pid] = nowMs }
        let launches = max(attempts, firstSeen.count)
        let ended = max(0, launches - running.count)
        if ended >= 2 { return .failedLaunches(ended) }
        for pid in running.sorted() where nowMs - (firstSeen[pid] ?? nowMs) > healthTimeoutMs {
            return .hung(pid)
        }
        return .keepWatching
    }
}
