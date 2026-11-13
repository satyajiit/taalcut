// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Puts the previous version back: the new bundle to updates/failed/, the clone to the app's place, the
/// library's pre-migration copy back when this exact update migrated it, then the record and a relaunch.
struct Rollback {
    let plan: GuardPlan
    let ports: GuardPorts

    enum Outcome: Equatable {
        case rolledBack
        /// Another guard already did it (pending.json is gone).
        case alreadyHandled
        /// A bundle that isn't Taalcut: nothing was moved.
        case refused
        case failed(String)
    }

    func run(reason: RollbackReason) -> Outcome {
        guard let lock = GuardLock.acquire(plan.lockFile) else { return .failed("could not lock \(plan.lockFile.path)") }
        defer { withExtendedLifetime(lock) {} }
        let files = ports.files
        guard files.fileExists(atPath: plan.pendingFile.path) else { return .alreadyHandled }
        guard files.fileExists(atPath: plan.rollbackApp.path) else {
            return .failed("no copy of \(plan.pending.from) at \(plan.rollbackApp.path)")
        }
        guard ports.isTaalcut(plan.rollbackApp, role: "rollbackApp") else { return .refused }
        if files.fileExists(atPath: plan.app.path), !ports.isTaalcut(plan.app, role: "appPath") { return .refused }
        ports.log.write("rolling back \(plan.pending.to) to \(plan.pending.from) (\(reason.rawValue))")
        if let problem = swapBundles() { return .failed(problem) }
        let restored = restoreLibrary()
        do {
            let record = RolledBackRecord(from: plan.pending.from, to: plan.pending.to, reason: reason, at: ports.clock.nowMs())
            try GuardRecords.write(record, to: plan.rolledBackRecord)
            try files.removeItem(at: plan.pendingFile)
        } catch {
            return .failed("could not write the rollback record: \(error)")
        }
        if !ports.launcher.launch(app: plan.app) { ports.log.write("could not reopen \(plan.app.path)") }
        if let problem = restored { return .failed(problem) }
        ports.log.write("rolled back; \(plan.pending.from) is at \(plan.app.path)")
        return .rolledBack
    }

    /// Moves the new version aside and the clone into place; puts the new one back if the second move fails.
    private func swapBundles() -> String? {
        let files = ports.files
        let failed = plan.failedApp
        do {
            try files.createDirectory(at: failed.deletingLastPathComponent(), withIntermediateDirectories: true)
            if files.fileExists(atPath: failed.path) { try files.removeItem(at: failed) }
            if files.fileExists(atPath: plan.app.path) { try files.moveItem(at: plan.app, to: failed) }
        } catch {
            return "could not move \(plan.pending.to) aside: \(error)"
        }
        do {
            try files.moveItem(at: plan.rollbackApp, to: plan.app)
            return nil
        } catch {
            try? files.moveItem(at: failed, to: plan.app)
            return "could not move \(plan.pending.from) back into place: \(error)"
        }
    }

    /// The pre-migration copy for exactly this from→to, over the library, with its WAL and shared memory gone.
    private func restoreLibrary() -> String? {
        let files = ports.files
        let copy = plan.preMigrationCopy
        guard files.fileExists(atPath: copy.path) else { return nil }
        let staging = plan.library.deletingLastPathComponent().appendingPathComponent(".restoring-\(plan.library.lastPathComponent)")
        do {
            if files.fileExists(atPath: staging.path) { try files.removeItem(at: staging) }
            try files.copyItem(at: copy, to: staging)
            if rename(staging.path, plan.library.path) != 0 { throw CocoaError(.fileWriteUnknown) }
            for suffix in ["-wal", "-shm"] {
                let sidecar = URL(fileURLWithPath: plan.library.path + suffix)
                if files.fileExists(atPath: sidecar.path) { try files.removeItem(at: sidecar) }
            }
            ports.log.write("restored the library from \(copy.lastPathComponent)")
            return nil
        } catch {
            return "could not restore the library from \(copy.path): \(error)"
        }
    }
}
