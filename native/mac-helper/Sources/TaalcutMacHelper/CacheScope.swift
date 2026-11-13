// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Darwin
import Foundation
import Security

/// Gives each development build of the helper its own cache of compiled Neural Engine models (FIX-OCRCOLD, SPEC
/// "OCR v2").
///
/// Apple's on-device compiler (E5RT, behind Vision's text models and the Core ML embedder) keeps what it compiles in
/// `~/Library/Caches/<process name>/com.apple.e5rt.e5bundlecache`, one folder per model and the same folder for every
/// build of one name, and a build only uses the bundles it compiled itself. Two builds named `taalcut-mac-helper`
/// that run on one Mac rewrite each other's bundles, so each recompiles models it had compiled, queued behind every
/// other compile on the Mac: measured on macOS 27.2, a build warm at 0.19 s was cold again at 56.8 s after a
/// re-signed copy of it had compiled. That happens where several builds run: every worktree's build on a developer's
/// Mac, and the installed app beside them. A development build (signed ad hoc, no Team ID) therefore names its
/// process after its CDHash, which moves its cache to a folder of its own, and marks the folder in use while it runs;
/// the app lets go of other builds' folders (desktop `helper-build-caches.ts`). A Developer ID build, the only one on
/// a person's Mac, keeps the plain name and its cache, which main's sweep looks after (desktop SPEC, IX3-B6), so an
/// update leaves no folder behind.
enum CacheScope {
    static let prefix = "taalcut-mac-helper-"
    /// `<cache folder>/.in-use/<pid>`: one file per running process of the build.
    static let inUseFolder = ".in-use"

    struct Signature: Equatable {
        var cdhash: String
        /// Set on a Developer ID signature; nil on an ad-hoc one.
        var team: String?
    }

    /// `taalcut-mac-helper-` and the first 16 hex digits of a CDHash; nil without one (an unsigned binary).
    static func name(cdhash: String?) -> String? {
        guard let cdhash, cdhash.count >= 16, cdhash.allSatisfy(\.isHexDigit) else { return nil }
        return prefix + cdhash.prefix(16).lowercased()
    }

    /// The cache name a build gets: its own for a development build, none (the plain name) for a Developer ID one.
    static func scopedName(for signature: Signature?) -> String? {
        guard let signature, signature.team == nil else { return nil }
        return name(cdhash: signature.cdhash)
    }

    /// Whether a cache folder's name is one `name(cdhash:)` gives.
    static func isScoped(_ folder: String) -> Bool {
        guard folder.hasPrefix(prefix) else { return false }
        let suffix = folder.dropFirst(prefix.count)
        return suffix.count == 16 && suffix.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }

    /// This process's signature: its CDHash, as hex, and its Team ID when it has one.
    static func ownSignature() -> Signature? {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
        var info: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
        guard SecCodeCopySigningInformation(staticCode, flags, &info) == errSecSuccess,
            let values = info as? [String: Any],
            let unique = values[kSecCodeInfoUnique as String] as? Data
        else { return nil }
        return Signature(
            cdhash: unique.map { String(format: "%02x", $0) }.joined(),
            team: values[kSecCodeInfoTeamIdentifier as String] as? String)
    }

    static var caches: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches", isDirectory: true)
    }

    /// For a development build: names this process for its build, before anything compiles, dates its cache folder
    /// now and marks it in use. Returns the name; nil for a Developer ID build or an unsigned one (plain name).
    @discardableResult
    static func apply(caches: URL = caches, now: Date = Date()) -> String? {
        guard let name = scopedName(for: ownSignature()) else { return nil }
        ProcessInfo.processInfo.processName = name
        let own = caches.appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.createDirectory(at: own, withIntermediateDirectories: true)
        try? FileManager.default.setAttributes([.modificationDate: now], ofItemAtPath: own.path)
        if let marker = markInUse(folder: own, pid: getpid()) { removeAtExit(marker) }
        return name
    }

    /// Writes `<folder>/.in-use/<pid>` and removes the markers of processes that are gone; the marker, or nil when
    /// it can't be written.
    static func markInUse(folder: URL, pid: Int32, alive: (Int32) -> Bool = processAlive) -> URL? {
        let manager = FileManager.default
        let markers = folder.appendingPathComponent(inUseFolder, isDirectory: true)
        guard (try? manager.createDirectory(at: markers, withIntermediateDirectories: true)) != nil else { return nil }
        for name in (try? manager.contentsOfDirectory(atPath: markers.path)) ?? [] {
            guard let other = Int32(name), other != pid, !alive(other) else { continue }
            try? manager.removeItem(at: markers.appendingPathComponent(name))
        }
        let marker = markers.appendingPathComponent(String(pid))
        return manager.createFile(atPath: marker.path, contents: Data()) ? marker : nil
    }

    /// Whether a process with this pid exists (signal 0 checks, sends nothing).
    static func processAlive(_ pid: Int32) -> Bool {
        kill(pid, 0) == 0 || errno == EPERM
    }

    private static func removeAtExit(_ marker: URL) {
        exitMarker = strdup(marker.path)
        atexit {
            if let path = CacheScope.exitMarker { unlink(path) }
        }
    }

    /// The marker `atexit` removes (a C callback can't capture it).
    nonisolated(unsafe) static var exitMarker: UnsafeMutablePointer<CChar>?
}
