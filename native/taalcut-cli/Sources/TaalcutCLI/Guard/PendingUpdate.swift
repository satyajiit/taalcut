// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// <userData>/updates/pending.json, written by the running version before it installs an update.
struct PendingUpdate: Codable, Equatable {
    let v: Int
    let from: String
    let to: String
    let appPath: String
    let rollbackApp: String
    let library: String
    let at: Double
    /// Raised by the new version's main first thing at every launch.
    let launchAttempts: Int

    init(v: Int = 1, from: String, to: String, appPath: String, rollbackApp: String, library: String, at: Double, launchAttempts: Int = 0) {
        self.v = v
        self.from = from
        self.to = to
        self.appPath = appPath
        self.rollbackApp = rollbackApp
        self.library = library
        self.at = at
        self.launchAttempts = launchAttempts
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        v = try container.decode(Int.self, forKey: .v)
        from = try container.decode(String.self, forKey: .from)
        to = try container.decode(String.self, forKey: .to)
        appPath = try container.decode(String.self, forKey: .appPath)
        rollbackApp = try container.decode(String.self, forKey: .rollbackApp)
        library = try container.decode(String.self, forKey: .library)
        at = try container.decode(Double.self, forKey: .at)
        launchAttempts = try container.decodeIfPresent(Int.self, forKey: .launchAttempts) ?? 0
    }

    static func read(_ file: URL) -> PendingUpdate? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(PendingUpdate.self, from: data)
    }
}

/// A pending update the guard may act on: every path it will touch, checked to be where it belongs.
struct GuardPlan: Equatable {
    let pendingFile: URL
    let updatesDir: URL
    let pending: PendingUpdate
    let app: URL
    let rollbackApp: URL
    let library: URL

    var executable: URL { app.appendingPathComponent("Contents/MacOS/Taalcut") }
    var healthyMarker: URL { updatesDir.appendingPathComponent("healthy-\(pending.to)") }
    var failedApp: URL { updatesDir.appendingPathComponent("failed/Taalcut-\(pending.to).app") }
    var rolledBackRecord: URL { updatesDir.appendingPathComponent("rolled-back.json") }
    var installFailedRecord: URL { updatesDir.appendingPathComponent("install-failed.json") }
    var lockFile: URL { updatesDir.appendingPathComponent("guard.lock") }
    /// The library's own copy from before the new version migrated it (library SPEC, pre-migration snapshot).
    var preMigrationCopy: URL {
        library.deletingLastPathComponent().appendingPathComponent("pre-migrate-\(pending.from)-\(pending.to).sqlite")
    }

    enum Problem: Error, Equatable, CustomStringConvertible {
        case unreadable(String)
        case unsupportedVersion(Int)
        case badVersionName(String)
        case badPath(String, String)

        var description: String {
            switch self {
            case .unreadable(let path): return "\(path) is missing or is not a pending update"
            case .unsupportedVersion(let v): return "pending.json version \(v) is not 1"
            case .badVersionName(let name): return "\(name) is not a version this guard can name files after"
            case .badPath(let field, let path): return "\(field) \(path) is outside what the guard may touch"
            }
        }
    }

    static func load(pendingPath: String) -> Result<GuardPlan, Problem> {
        let file = URL(fileURLWithPath: pendingPath)
        guard isPlainAbsolute(pendingPath), let pending = PendingUpdate.read(file) else {
            return .failure(.unreadable(pendingPath))
        }
        return validate(pending, pendingFile: file)
    }

    static func validate(_ pending: PendingUpdate, pendingFile: URL) -> Result<GuardPlan, Problem> {
        guard pending.v == 1 else { return .failure(.unsupportedVersion(pending.v)) }
        for version in [pending.from, pending.to] where !isVersionName(version) {
            return .failure(.badVersionName(version))
        }
        let updatesDir = pendingFile.deletingLastPathComponent()
        guard isPlainAbsolute(pending.appPath), pending.appPath.hasSuffix(".app"), pending.appPath.count > 5 else {
            return .failure(.badPath("appPath", pending.appPath))
        }
        guard isPlainAbsolute(pending.rollbackApp), pending.rollbackApp.hasSuffix(".app"),
            pending.rollbackApp.hasPrefix(updatesDir.path + "/")
        else { return .failure(.badPath("rollbackApp", pending.rollbackApp)) }
        // pending.json lives in <userData>/updates/; the library is always <userData>/catalog/library.sqlite.
        let expectedLibrary = updatesDir.deletingLastPathComponent().appendingPathComponent("catalog/library.sqlite").path
        guard isPlainAbsolute(pending.library), pending.library == expectedLibrary else {
            return .failure(.badPath("library", pending.library))
        }
        return .success(
            GuardPlan(
                pendingFile: pendingFile,
                updatesDir: updatesDir,
                pending: pending,
                app: URL(fileURLWithPath: pending.appPath),
                rollbackApp: URL(fileURLWithPath: pending.rollbackApp),
                library: URL(fileURLWithPath: pending.library)
            ))
    }

    /// Absolute, with no `.`, `..` or empty components, so a prefix check means what it says.
    static func isPlainAbsolute(_ path: String) -> Bool {
        guard path.hasPrefix("/"), path.count > 1, !path.hasSuffix("/") else { return false }
        return !path.dropFirst().split(separator: "/", omittingEmptySubsequences: false).contains { part in
            part.isEmpty || part == "." || part == ".."
        }
    }

    /// Semver-ish: letters, digits, `.`, `+`, `-`; never a path.
    static func isVersionName(_ text: String) -> Bool {
        guard (1...64).contains(text.utf8.count), !text.contains(".."), text.first != "." else { return false }
        return text.utf8.allSatisfy { byte in
            (0x30...0x39).contains(byte) || (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte)
                || byte == 0x2E || byte == 0x2B || byte == 0x2D
        }
    }
}
