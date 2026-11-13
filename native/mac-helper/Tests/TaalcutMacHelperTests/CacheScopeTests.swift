// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

/// FIX-OCRCOLD: a development build's own cache of compiled models. `apply` itself isn't called here: renaming the
/// test process would move its own OCR tests onto a cold cache.
@Suite struct CacheScopeTests {
    @Test func aDevelopmentBuildIsNamedByItsSignature() {
        let hash = "4ACBBE89E9055F420F00BD1EE8AEC5749B588F45"
        #expect(CacheScope.name(cdhash: hash) == "taalcut-mac-helper-4acbbe89e9055f42")
        #expect(CacheScope.name(cdhash: nil) == nil)
        #expect(CacheScope.name(cdhash: "4acbbe89") == nil)
        #expect(CacheScope.name(cdhash: "zzzzzzzzzzzzzzzzzzzz") == nil)
        // Ad hoc (no Team ID): its own cache. Developer ID: the plain name, the only build on a person's Mac.
        #expect(CacheScope.scopedName(for: .init(cdhash: hash, team: nil)) == "taalcut-mac-helper-4acbbe89e9055f42")
        #expect(CacheScope.scopedName(for: .init(cdhash: hash, team: "A1B2C3D4E5")) == nil)
        #expect(CacheScope.scopedName(for: nil) == nil)
        // The test binary is signed ad hoc (the linker signs every arm64 binary), as a development helper is.
        let own = CacheScope.ownSignature()
        #expect(own?.cdhash.count == 40)
        #expect(own?.team == nil)
        #expect(CacheScope.scopedName(for: own).map(CacheScope.isScoped) == true)
    }

    @Test func knowsItsOwnFolderNames() {
        #expect(CacheScope.isScoped("taalcut-mac-helper-4acbbe89e9055f42"))
        #expect(!CacheScope.isScoped("taalcut-mac-helper"))
        #expect(!CacheScope.isScoped("taalcut-mac-helper.baseline"))
        #expect(!CacheScope.isScoped("taalcut-mac-helper-4ACBBE89E9055F42"))
        #expect(!CacheScope.isScoped("taalcut-mac-helper-4acbbe89e9055f4"))
        #expect(!CacheScope.isScoped("taalcut-mac-helper-4acbbe89e9055f42x"))
        #expect(!CacheScope.isScoped("com.apple.something-4acbbe89e9055f42"))
    }

    @Test func marksItsFolderInUseAndClearsMarkersOfProcessesGone() throws {
        let manager = FileManager.default
        let folder = manager.temporaryDirectory.appendingPathComponent("cache-scope-\(UUID().uuidString)")
        defer { try? manager.removeItem(at: folder) }
        let markers = folder.appendingPathComponent(CacheScope.inUseFolder)
        try manager.createDirectory(at: markers, withIntermediateDirectories: true)
        for name in ["111", "222", "notes"] {
            manager.createFile(atPath: markers.appendingPathComponent(name).path, contents: Data())
        }
        // 111 is gone, 222 still runs; a file that names no process is left alone.
        let marker = CacheScope.markInUse(folder: folder, pid: 333, alive: { $0 == 222 })
        #expect(marker?.lastPathComponent == "333")
        #expect(try manager.contentsOfDirectory(atPath: markers.path).sorted() == ["222", "333", "notes"])
        #expect(CacheScope.processAlive(getpid()))
    }
}
