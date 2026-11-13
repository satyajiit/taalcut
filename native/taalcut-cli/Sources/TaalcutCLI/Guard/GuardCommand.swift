// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Darwin
import Foundation

/// `taalcut update-guard`. Exit codes: 0 done, 2 bad arguments or pending file, 3 rollback failed.
public enum GuardCommand {
    public static func run(_ arguments: [String]) -> Int32 {
        // Started detached by the version that installs the update; it must outlive that app's session.
        signal(SIGHUP, SIG_IGN)
        let log = StderrLog(prefix: "update-guard")
        let ports = GuardPorts(
            clock: SystemClock(),
            processes: LibprocProcessLister(),
            signals: PosixSignaller(),
            launcher: OpenAppLauncher(),
            log: log,
            files: .default
        )
        return run(arguments, ports: ports)
    }

    static func run(_ arguments: [String], ports: GuardPorts) -> Int32 {
        let options: GuardOptions
        switch GuardOptions.parse(arguments) {
        case .success(let parsed): options = parsed
        case .failure(let problem):
            ports.log.write(problem.description)
            return 2
        }
        switch GuardPlan.load(pendingPath: options.pendingPath) {
        case .success(let plan):
            return UpdateGuard(plan: plan, options: options, ports: ports).run().rawValue
        case .failure(let problem):
            ports.log.write(problem.description)
            return 2
        }
    }
}
