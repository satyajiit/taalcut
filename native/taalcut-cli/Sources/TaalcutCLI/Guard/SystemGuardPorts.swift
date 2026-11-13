// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Darwin
import Foundation

struct SystemClock: GuardClock {
    func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }
    func sleep(ms: Int) { usleep(useconds_t(max(0, ms)) * 1000) }
}

/// libproc: every pid whose executable path is the app's main executable (helpers live elsewhere).
struct LibprocProcessLister: ProcessLister {
    func pids(runningExecutable executable: URL) -> [Int32] {
        let wanted = executable.resolvingSymlinksInPath().path
        let capacity = Int(proc_listallpids(nil, 0)) + 64
        guard capacity > 64 else { return [] }
        var pids = [pid_t](repeating: 0, count: capacity)
        let count = Int(proc_listallpids(&pids, Int32(capacity * MemoryLayout<pid_t>.size)))
        guard count > 0 else { return [] }
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        return pids.prefix(count).filter { pid in
            guard pid > 0, proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return false }
            let path = buffer.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
            return URL(fileURLWithPath: path).resolvingSymlinksInPath().path == wanted
        }
    }
}

struct PosixSignaller: Signaller {
    func terminate(_ pid: Int32) { _ = Darwin.kill(pid, SIGTERM) }
    func kill(_ pid: Int32) { _ = Darwin.kill(pid, SIGKILL) }
    func isAlive(_ pid: Int32) -> Bool { Darwin.kill(pid, 0) == 0 || errno == EPERM }
}

/// `/usr/bin/open <app>`: Launch Services starts it as the person would.
struct OpenAppLauncher: AppLauncher {
    func launch(app: URL) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = [app.path]
        do {
            try process.run()
        } catch {
            return false
        }
        process.waitUntilExit()
        return process.terminationStatus == 0
    }
}
