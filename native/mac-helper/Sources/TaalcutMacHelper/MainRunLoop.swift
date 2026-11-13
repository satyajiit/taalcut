// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreFoundation
import Foundation

/// Exit code of a devices serve, published once from the stdin task.
private final class ExitBox: @unchecked Sendable {
    private let lock = NSLock()
    private var finished = false
    private var code: Int32 = 0

    func finish(_ code: Int32) {
        lock.lock()
        self.code = code
        finished = true
        lock.unlock()
    }

    func poll() -> Int32? {
        lock.lock()
        defer { lock.unlock() }
        return finished ? code : nil
    }
}

/// Serves `devices` beside `CFRunLoopRunInMode` on the calling thread.
///
/// ImageCaptureCore delivers delegate callbacks on the main thread, and only in
/// the default mode. Call this from the process entry, before the entry suspends,
/// so the loop is that thread's own frame. A loop started from a main-queue block
/// never drains that queue, and `ICDeviceBrowser.start()` does not return.
func runDevicesServe(_ arguments: [String]) -> Int32 {
    precondition(Thread.isMainThread)
    let box = ExitBox()
    Task.detached {
        let code = await HelperCommand.run(arguments)
        box.finish(code)
        CFRunLoopStop(CFRunLoopGetMain())
    }
    while true {
        if let code = box.poll() { return code }
        _ = CFRunLoopRunInMode(.defaultMode, 0.25, false)
    }
}
