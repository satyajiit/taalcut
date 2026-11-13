// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutCLI

@Suite("update-guard watches the new version")
struct GuardWatchTests {
    @Test("not installed within the timeout: install-failed.json, the clone and pending.json removed, nothing rolled back")
    func installTimeout() {
        let sandbox = GuardSandbox(installed: GuardSandbox.from)
        let world = GuardWorld()
        #expect(world.run(sandbox, ["--install-timeout-ms", "2000"]) == 0)
        #expect(sandbox.exists(sandbox.updates.appendingPathComponent("install-failed.json")))
        #expect(!sandbox.exists(sandbox.rollbackApp))
        #expect(!sandbox.exists(sandbox.pendingFile))
        #expect(BundleVersion.of(sandbox.app) == GuardSandbox.from)
        #expect(sandbox.rolledBack() == nil)
        #expect(world.launcher.launched.isEmpty)
        #expect(world.clock.now == 2000)
    }

    @Test("installed, launched, healthy: the guard leaves everything as it is")
    func healthy() {
        let sandbox = GuardSandbox(installed: GuardSandbox.from)
        let world = GuardWorld()
        world.clock.onTick = { now in
            if now == 1000 { sandbox.setInstalled(GuardSandbox.to) }
            if now == 3000 { sandbox.writeHealthy() }
        }
        world.processes.running = { now in now >= 1500 ? [100] : [] }
        #expect(world.run(sandbox) == 0)
        #expect(world.clock.now == 3000)
        #expect(sandbox.exists(sandbox.pendingFile))
        #expect(sandbox.exists(sandbox.rollbackApp))
        #expect(sandbox.rolledBack() == nil)
        #expect(world.processes.asked.allSatisfy { $0.path == sandbox.app.path + "/Contents/MacOS/Taalcut" })
    }

    @Test("two launches that end without the marker roll back")
    func twoFailedLaunches() {
        let sandbox = GuardSandbox()
        let world = GuardWorld()
        world.processes.running = { now in
            if now < 1000 { return [100] }
            if now >= 2000 && now < 3000 { return [101] }
            return []
        }
        #expect(world.run(sandbox) == 0)
        #expect(sandbox.rolledBack()?.reason == .launchFailed)
        #expect(world.clock.now == 3000)
        #expect(BundleVersion.of(sandbox.app) == GuardSandbox.from)
    }

    @Test("crashes too quick to see are counted from launchAttempts")
    func countsAttempts() {
        let sandbox = GuardSandbox()
        let world = GuardWorld()
        world.clock.onTick = { now in
            if now == 500 { sandbox.writePending(launchAttempts: 1) }
            if now == 1000 { sandbox.writePending(launchAttempts: 2) }
        }
        #expect(world.run(sandbox) == 0)
        #expect(sandbox.rolledBack() == RolledBackRecord(from: GuardSandbox.from, to: GuardSandbox.to, reason: .launchFailed, at: 1000))
    }

    @Test("a launch running past the health timeout is stopped (SIGKILL after an ignored SIGTERM) and rolled back")
    func hung() {
        let sandbox = GuardSandbox()
        let world = GuardWorld(ignoresTerminate: true)
        world.processes.running = { _ in [100] }
        #expect(world.run(sandbox, ["--health-timeout-ms", "3000"]) == 0)
        #expect(world.signals.terminated == [100])
        #expect(world.signals.killed == [100])
        #expect(sandbox.rolledBack()?.reason == .hung)
        // 3.5 s to pass the timeout, then the 5 s grace before SIGKILL.
        #expect(world.clock.now >= 8500)
    }

    @Test("a hung launch that obeys SIGTERM is not killed")
    func hungButPolite() {
        let sandbox = GuardSandbox()
        let world = GuardWorld()
        world.processes.running = { _ in [100] }
        #expect(world.run(sandbox, ["--health-timeout-ms", "3000"]) == 0)
        #expect(world.signals.terminated == [100])
        #expect(world.signals.killed.isEmpty)
        #expect(sandbox.rolledBack()?.reason == .hung)
    }

    @Test("--rollback-now waits for the app to quit, then rolls back at once")
    func rollbackNow() {
        let sandbox = GuardSandbox()
        let world = GuardWorld()
        world.processes.running = { now in now < 1000 ? [100] : [] }
        #expect(world.run(sandbox, ["--rollback-now"]) == 0)
        #expect(world.clock.now == 1000)
        #expect(world.signals.terminated.isEmpty)
        #expect(sandbox.rolledBack()?.reason == .rollbackNow)
        #expect(world.launcher.launched.map(\.path) == [sandbox.app.path])
    }

    @Test("a healthy marker from an earlier try of the same version doesn't count")
    func staleMarker() {
        let sandbox = GuardSandbox()
        sandbox.writeHealthy()
        sandbox.writePending(at: Date().timeIntervalSince1970 * 1000 + 3_600_000)
        let world = GuardWorld()
        world.processes.running = { now in now < 1000 ? [100] : (now < 2000 ? [] : (now < 2500 ? [101] : [])) }
        #expect(world.run(sandbox) == 0)
        #expect(sandbox.rolledBack()?.reason == .launchFailed)
    }

    @Test("the verdicts on their own")
    func verdicts() {
        var watch = LaunchWatch(healthTimeoutMs: 1000)
        #expect(watch.observe(nowMs: 0, running: [7], attempts: 1, healthy: false) == .keepWatching)
        #expect(watch.observe(nowMs: 500, running: [], attempts: 1, healthy: false) == .keepWatching)
        #expect(watch.observe(nowMs: 600, running: [8], attempts: 1, healthy: false) == .keepWatching)
        #expect(watch.observe(nowMs: 1700, running: [8], attempts: 2, healthy: false) == .hung(8))
        #expect(watch.observe(nowMs: 1800, running: [8], attempts: 2, healthy: true) == .healthy)
        #expect(watch.observe(nowMs: 1900, running: [], attempts: 2, healthy: false) == .failedLaunches(2))
    }
}
