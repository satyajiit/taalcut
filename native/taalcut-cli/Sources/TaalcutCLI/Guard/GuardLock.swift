// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Darwin
import Foundation

/// An exclusive flock on updates/guard.lock, so a living guard and a `--rollback-now` guard never roll back
/// at the same time. Released when the guard exits.
final class GuardLock {
    private let fd: Int32

    private init(fd: Int32) {
        self.fd = fd
    }

    static func acquire(_ file: URL) -> GuardLock? {
        let fd = open(file.path, O_CREAT | O_RDWR | O_CLOEXEC, 0o600)
        guard fd >= 0 else { return nil }
        guard flock(fd, LOCK_EX) == 0 else {
            close(fd)
            return nil
        }
        return GuardLock(fd: fd)
    }

    deinit {
        flock(fd, LOCK_UN)
        close(fd)
    }
}
