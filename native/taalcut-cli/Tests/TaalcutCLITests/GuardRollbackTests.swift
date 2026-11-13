// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutCLI

@Suite("update-guard rolls back")
struct GuardRollbackTests {
    @Test("the clone goes back, the new version to failed/, the matching pre-migration library is restored, the app reopens")
    func rollsBack() throws {
        let sandbox = GuardSandbox()
        let catalog = sandbox.library.deletingLastPathComponent()
        try Data("original".utf8).write(to: catalog.appendingPathComponent("pre-migrate-\(GuardSandbox.from)-\(GuardSandbox.to).sqlite"))
        try Data("wal".utf8).write(to: URL(fileURLWithPath: sandbox.library.path + "-wal"))
        try Data("shm".utf8).write(to: URL(fileURLWithPath: sandbox.library.path + "-shm"))
        let failed = sandbox.updates.appendingPathComponent("failed/Taalcut-\(GuardSandbox.to).app")
        GuardSandbox.makeBundle(failed, version: "older-failure")
        let world = GuardWorld()
        #expect(world.run(sandbox, ["--rollback-now"]) == 0)
        #expect(BundleVersion.of(sandbox.app) == GuardSandbox.from)
        #expect(BundleVersion.of(failed) == GuardSandbox.to)
        #expect(!sandbox.exists(sandbox.rollbackApp))
        #expect(!sandbox.exists(sandbox.pendingFile))
        #expect(sandbox.text(sandbox.library) == "original")
        #expect(!sandbox.exists(URL(fileURLWithPath: sandbox.library.path + "-wal")))
        #expect(!sandbox.exists(URL(fileURLWithPath: sandbox.library.path + "-shm")))
        let record = try #require(sandbox.rolledBack())
        #expect(record == RolledBackRecord(from: GuardSandbox.from, to: GuardSandbox.to, reason: .rollbackNow, at: 0))
        #expect(world.launcher.launched.map(\.path) == [sandbox.app.path])
        let json = try #require(sandbox.text(sandbox.updates.appendingPathComponent("rolled-back.json")))
        #expect(json.contains("\"reason\":\"rollback-now\""))
        #expect(json.contains("\"v\":1"))
    }

    @Test("a pre-migration copy from another update is left alone")
    func otherMigrationUntouched() throws {
        let sandbox = GuardSandbox()
        let catalog = sandbox.library.deletingLastPathComponent()
        try Data("older".utf8).write(to: catalog.appendingPathComponent("pre-migrate-0.0.0-alpha.9-\(GuardSandbox.from).sqlite"))
        #expect(GuardWorld().run(sandbox, ["--rollback-now"]) == 0)
        #expect(sandbox.text(sandbox.library) == "migrated")
    }

    @Test("no clone to go back to: exit 3 and the new version stays")
    func noClone() throws {
        let sandbox = GuardSandbox()
        try FileManager.default.removeItem(at: sandbox.rollbackApp)
        let world = GuardWorld()
        #expect(world.run(sandbox, ["--rollback-now"]) == 3)
        #expect(BundleVersion.of(sandbox.app) == GuardSandbox.to)
        #expect(sandbox.exists(sandbox.pendingFile))
        #expect(world.launcher.launched.isEmpty)
    }

    @Test("another guard got there first: nothing moves")
    func alreadyHandled() throws {
        let sandbox = GuardSandbox()
        let plan = try GuardPlan.load(pendingPath: sandbox.pendingFile.path).get()
        try FileManager.default.removeItem(at: sandbox.pendingFile)
        #expect(Rollback(plan: plan, ports: GuardWorld().ports).run(reason: .launchFailed) == .alreadyHandled)
        #expect(BundleVersion.of(sandbox.app) == GuardSandbox.to)
        #expect(sandbox.exists(sandbox.rollbackApp))
    }

    @Test("pending files pointing outside the guard's reach are refused with exit 2")
    func confinement() {
        let sandbox = GuardSandbox()
        let world = GuardWorld()
        let cases: [() -> Void] = [
            { sandbox.writePending(rollbackApp: sandbox.root.appendingPathComponent("elsewhere/Taalcut.app").path) },
            { sandbox.writePending(rollbackApp: sandbox.updates.path + "/../../Taalcut.app") },
            { sandbox.writePending(appPath: sandbox.root.path + "/Applications/../Taalcut.app") },
            { sandbox.writePending(appPath: sandbox.root.path + "/Applications/Taalcut") },
            { sandbox.writePending(library: sandbox.root.path + "/userData/catalog/library.db") },
            { sandbox.writePending(library: sandbox.root.path + "/userData/catalog/other.sqlite") },
            { sandbox.writePending(library: sandbox.root.path + "/elsewhere/catalog/library.sqlite") },
            { sandbox.writePending(library: sandbox.root.path + "/userData/updates/catalog/library.sqlite") },
            { sandbox.writePending(to: "../../etc") },
            { sandbox.writePending(v: 2) },
        ]
        for writeBadPending in cases {
            writeBadPending()
            #expect(world.run(sandbox, ["--rollback-now"]) == 2)
            #expect(BundleVersion.of(sandbox.app) == GuardSandbox.to)
        }
        #expect(GuardCommand.run(["--pending", "relative/pending.json"], ports: world.ports) == 2)
        #expect(GuardCommand.run(["--pending", sandbox.pendingFile.path, "--nope"], ports: world.ports) == 2)
        #expect(GuardCommand.run(["--pending", sandbox.pendingFile.path, "--poll-ms", "0"], ports: world.ports) == 2)
        #expect(GuardCommand.run([], ports: world.ports) == 2)
    }

    @Test("an app at appPath that isn't Taalcut is refused before anything moves")
    func foreignApp() {
        let sandbox = GuardSandbox()
        GuardSandbox.makeBundle(sandbox.app, version: GuardSandbox.to, identifier: "com.example.other")
        let world = GuardWorld()
        world.processes.running = { _ in [] }
        #expect(world.run(sandbox) == 2)
        #expect(world.run(sandbox, ["--rollback-now"]) == 2)
        #expect(BundleVersion.identifier(of: sandbox.app) == "com.example.other")
        #expect(sandbox.exists(sandbox.rollbackApp))
        #expect(sandbox.exists(sandbox.pendingFile))
        #expect(world.launcher.launched.isEmpty)
        #expect(world.log.messages.contains { $0.contains("refusing: appPath") })
    }

    @Test("a rollback copy that isn't Taalcut is never moved into place")
    func foreignClone() {
        let sandbox = GuardSandbox()
        GuardSandbox.makeBundle(sandbox.rollbackApp, version: GuardSandbox.from, identifier: "com.example.other")
        let world = GuardWorld()
        #expect(world.run(sandbox, ["--rollback-now"]) == 2)
        #expect(BundleVersion.of(sandbox.app) == GuardSandbox.to)
        #expect(BundleVersion.identifier(of: sandbox.rollbackApp) == "com.example.other")
        #expect(sandbox.exists(sandbox.pendingFile))
        #expect(sandbox.rolledBack() == nil)
        #expect(world.launcher.launched.isEmpty)
    }

    @Test("the expected bundle identifier is injected like the other ports")
    func injectedIdentifier() {
        let sandbox = GuardSandbox()
        GuardSandbox.makeBundle(sandbox.app, version: GuardSandbox.to, identifier: "com.taalcut.test")
        GuardSandbox.makeBundle(sandbox.rollbackApp, version: GuardSandbox.from, identifier: "com.taalcut.test")
        #expect(GuardWorld().run(sandbox, ["--rollback-now"]) == 2)
        var world = GuardWorld()
        world.bundleId = "com.taalcut.test"
        #expect(world.run(sandbox, ["--rollback-now"]) == 0)
        #expect(BundleVersion.of(sandbox.app) == GuardSandbox.from)
    }

    @Test("arguments and their defaults")
    func options() throws {
        let defaults = try GuardOptions.parse(["--pending", "/u/updates/pending.json"]).get()
        #expect(defaults == GuardOptions(pendingPath: "/u/updates/pending.json"))
        #expect(defaults.installTimeoutMs == 600_000)
        #expect(defaults.healthTimeoutMs == 90_000)
        #expect(defaults.pollMs == 500)
        let custom = try GuardOptions.parse([
            "--rollback-now", "--pending", "/p.json", "--install-timeout-ms", "10", "--health-timeout-ms", "20", "--poll-ms", "30",
        ]).get()
        #expect(custom.rollbackNow)
        #expect([custom.installTimeoutMs, custom.healthTimeoutMs, custom.pollMs] as [Int] == [10, 20, 30])
    }
}
