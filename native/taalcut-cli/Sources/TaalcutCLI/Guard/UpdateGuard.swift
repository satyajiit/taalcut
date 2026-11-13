// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// The update guard (desktop SPEC, "Rollback on a failed launch"): waits for the update to replace the app,
/// then watches the new version's launches until it writes its healthy marker, and rolls back when it
/// can't start twice, hangs, or asks for it (`--rollback-now`).
struct UpdateGuard {
    let plan: GuardPlan
    let options: GuardOptions
    let ports: GuardPorts

    enum Exit: Int32 {
        case done = 0
        case refused = 2
        case rollbackFailed = 3
    }

    func run() -> Exit {
        log("guarding \(plan.pending.from) → \(plan.pending.to) at \(plan.app.path)")
        guard ports.isTaalcut(plan.app, role: "appPath") else { return .refused }
        if options.rollbackNow {
            waitForQuit()
            return rollBack(.rollbackNow)
        }
        guard waitForInstall() else { return .done }
        return watchLaunches()
    }

    /// True once the app is the new version; false when the guard has nothing left to do.
    private func waitForInstall() -> Bool {
        let deadline = ports.clock.nowMs() + Double(options.installTimeoutMs)
        while true {
            if !pendingExists() {
                log("pending.json is gone; nothing to guard")
                return false
            }
            if BundleVersion.of(plan.app) == plan.pending.to {
                log("installed \(plan.pending.to)")
                return true
            }
            if ports.clock.nowMs() >= deadline {
                recordInstallFailure()
                return false
            }
            ports.clock.sleep(ms: options.pollMs)
        }
    }

    private func watchLaunches() -> Exit {
        var watch = LaunchWatch(healthTimeoutMs: Double(options.healthTimeoutMs))
        var attempts = plan.pending.launchAttempts
        while true {
            guard pendingExists() else {
                log("pending.json is gone; nothing to guard")
                return .done
            }
            attempts = PendingUpdate.read(plan.pendingFile)?.launchAttempts ?? attempts
            let running = ports.processes.pids(runningExecutable: plan.executable)
            switch watch.observe(nowMs: ports.clock.nowMs(), running: running, attempts: attempts, healthy: isHealthy()) {
            case .healthy:
                log("\(plan.pending.to) is healthy")
                return .done
            case .failedLaunches(let count):
                log("\(count) launches of \(plan.pending.to) ended before it was healthy")
                return rollBack(.launchFailed)
            case .hung(let pid):
                log("\(plan.pending.to) (pid \(pid)) wasn't healthy within \(options.healthTimeoutMs) ms")
                stop(pid)
                return rollBack(.hung)
            case .keepWatching:
                ports.clock.sleep(ms: options.pollMs)
            }
        }
    }

    /// A marker written for this pending update, not a stale one from an earlier try of the same version.
    private func isHealthy() -> Bool {
        guard let attributes = try? ports.files.attributesOfItem(atPath: plan.healthyMarker.path) else { return false }
        guard let written = attributes[.modificationDate] as? Date else { return true }
        return written.timeIntervalSince1970 * 1000 >= plan.pending.at - 1000
    }

    private func waitForQuit() {
        let deadline = ports.clock.nowMs() + Double(options.quitWaitMs)
        while ports.clock.nowMs() < deadline {
            if ports.processes.pids(runningExecutable: plan.executable).isEmpty { return }
            ports.clock.sleep(ms: options.pollMs)
        }
        for pid in ports.processes.pids(runningExecutable: plan.executable) { stop(pid) }
    }

    /// SIGTERM, then SIGKILL once the grace period is over.
    private func stop(_ pid: Int32) {
        ports.signals.terminate(pid)
        let deadline = ports.clock.nowMs() + Double(options.terminateGraceMs)
        while ports.signals.isAlive(pid) {
            if ports.clock.nowMs() >= deadline {
                log("pid \(pid) ignored SIGTERM; killing it")
                ports.signals.kill(pid)
                return
            }
            ports.clock.sleep(ms: min(options.pollMs, 250))
        }
    }

    private func rollBack(_ reason: RollbackReason) -> Exit {
        switch Rollback(plan: plan, ports: ports).run(reason: reason) {
        case .rolledBack:
            return .done
        case .alreadyHandled:
            log("another guard already handled this update")
            return .done
        case .refused:
            return .refused
        case .failed(let problem):
            log("rollback failed: \(problem)")
            return .rollbackFailed
        }
    }

    private func recordInstallFailure() {
        log("\(plan.pending.to) wasn't installed within \(options.installTimeoutMs) ms")
        let record = InstallFailedRecord(from: plan.pending.from, to: plan.pending.to, at: ports.clock.nowMs())
        do {
            try GuardRecords.write(record, to: plan.installFailedRecord)
        } catch {
            log("could not write \(plan.installFailedRecord.path): \(error)")
        }
        for file in [plan.rollbackApp, plan.pendingFile] where ports.files.fileExists(atPath: file.path) {
            do {
                try ports.files.removeItem(at: file)
            } catch {
                log("could not remove \(file.path): \(error)")
            }
        }
    }

    private func pendingExists() -> Bool { ports.files.fileExists(atPath: plan.pendingFile.path) }
    private func log(_ message: String) { ports.log.write(message) }
}
