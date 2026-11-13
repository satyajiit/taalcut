// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Why the guard put the previous version back.
enum RollbackReason: String, Codable, Equatable {
    case installTimeout = "install-timeout"
    case launchFailed = "launch-failed"
    case hung
    case rollbackNow = "rollback-now"
}

/// updates/rolled-back.json: the restored version (`from`) reads it at start for About's notice.
struct RolledBackRecord: Codable, Equatable {
    var v = 1
    let from: String
    let to: String
    let reason: RollbackReason
    let at: Double
}

/// updates/install-failed.json: the update never replaced the app, so nothing was rolled back.
struct InstallFailedRecord: Codable, Equatable {
    var v = 1
    let from: String
    let to: String
    let at: Double
}

enum GuardRecords {
    static func write<Record: Encodable>(_ record: Record, to file: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(record).write(to: file, options: .atomic)
    }
}
