// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Time for the guard: real in the app, fake in tests (sleeping advances it).
protocol GuardClock {
    func nowMs() -> Double
    func sleep(ms: Int)
}

/// Which processes run a given executable.
protocol ProcessLister {
    func pids(runningExecutable executable: URL) -> [Int32]
}

protocol Signaller {
    func terminate(_ pid: Int32)
    func kill(_ pid: Int32)
    func isAlive(_ pid: Int32) -> Bool
}

/// Starts the app again after a rollback.
protocol AppLauncher {
    func launch(app: URL) -> Bool
}

struct GuardPorts {
    let clock: GuardClock
    let processes: ProcessLister
    let signals: Signaller
    let launcher: AppLauncher
    let log: DiagnosticLog
    let files: FileManager
    /// The CFBundleIdentifier both bundles must have before the guard moves either.
    var bundleId: String = BuildStamp.appBundleId

    /// Whether `app` is a Taalcut bundle; logs why not.
    func isTaalcut(_ app: URL, role: String) -> Bool {
        let identifier = BundleVersion.identifier(of: app)
        if identifier == bundleId { return true }
        log.write("refusing: \(role) \(app.path) is \(identifier ?? "not an app bundle"), not \(bundleId)")
        return false
    }
}
