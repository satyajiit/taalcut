// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

@testable import TaalcutCLI

/// Time that moves only when the guard sleeps; `onTick` scripts the world at each new time.
final class FakeClock: GuardClock {
    private(set) var now: Double = 0
    var onTick: (Double) -> Void = { _ in }

    func nowMs() -> Double { now }

    func sleep(ms: Int) {
        now += Double(ms)
        onTick(now)
    }
}

/// The app's processes as a function of the fake time.
final class ScriptedProcesses: ProcessLister {
    private let clock: FakeClock
    var running: (Double) -> [Int32]
    private(set) var asked: [URL] = []

    init(clock: FakeClock, running: @escaping (Double) -> [Int32] = { _ in [] }) {
        self.clock = clock
        self.running = running
    }

    func pids(runningExecutable executable: URL) -> [Int32] {
        asked.append(executable)
        return running(clock.now).filter { !killedOrGone.contains($0) }
    }

    /// Pids a signal ended.
    var killedOrGone: Set<Int32> = []
}

final class FakeSignals: Signaller {
    private let processes: ScriptedProcesses
    let ignoresTerminate: Bool
    private(set) var terminated: [Int32] = []
    private(set) var killed: [Int32] = []

    init(processes: ScriptedProcesses, ignoresTerminate: Bool) {
        self.processes = processes
        self.ignoresTerminate = ignoresTerminate
    }

    func terminate(_ pid: Int32) {
        terminated.append(pid)
        if !ignoresTerminate { processes.killedOrGone.insert(pid) }
    }

    func kill(_ pid: Int32) {
        killed.append(pid)
        processes.killedOrGone.insert(pid)
    }

    func isAlive(_ pid: Int32) -> Bool { !processes.killedOrGone.contains(pid) }
}

final class FakeLauncher: AppLauncher {
    private(set) var launched: [URL] = []

    func launch(app: URL) -> Bool {
        launched.append(app)
        return true
    }
}

/// A Mac in a folder: /Applications/Taalcut.app at the new version, userData with the pending update, the
/// rollback clone and a library.
struct GuardSandbox {
    static let from = "0.0.0-beta.1"
    static let to = "0.0.0-beta.2"

    let root: URL
    let app: URL
    let updates: URL
    let rollbackApp: URL
    let library: URL
    var pendingFile: URL { updates.appendingPathComponent("pending.json") }

    init(installed: String = GuardSandbox.to) {
        root = temporaryDirectory("guard")
        app = root.appendingPathComponent("Applications/Taalcut.app")
        updates = root.appendingPathComponent("userData/updates")
        rollbackApp = updates.appendingPathComponent("rollback/Taalcut-\(Self.from).app")
        library = root.appendingPathComponent("userData/catalog/library.sqlite")
        Self.makeBundle(app, version: installed)
        Self.makeBundle(rollbackApp, version: Self.from)
        try? FileManager.default.createDirectory(at: library.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data("migrated".utf8).write(to: library)
        writePending()
    }

    func writePending(launchAttempts: Int = 0, at: Double = 0, rollbackApp custom: String? = nil, appPath: String? = nil, library customLibrary: String? = nil, to: String = GuardSandbox.to, v: Int = 1) {
        let pending = PendingUpdate(
            v: v, from: Self.from, to: to,
            appPath: appPath ?? app.path,
            rollbackApp: custom ?? rollbackApp.path,
            library: customLibrary ?? library.path,
            at: at, launchAttempts: launchAttempts)
        try? FileManager.default.createDirectory(at: updates, withIntermediateDirectories: true)
        try? JSONEncoder().encode(pending).write(to: pendingFile)
    }

    func setInstalled(_ version: String) { Self.makeBundle(app, version: version) }

    func writeHealthy(_ version: String = GuardSandbox.to) {
        try? Data().write(to: updates.appendingPathComponent("healthy-\(version)"))
    }

    func text(_ file: URL) -> String? { (try? Data(contentsOf: file)).map { String(decoding: $0, as: UTF8.self) } }
    func exists(_ file: URL) -> Bool { FileManager.default.fileExists(atPath: file.path) }

    func rolledBack() -> RolledBackRecord? {
        (try? Data(contentsOf: updates.appendingPathComponent("rolled-back.json"))).flatMap {
            try? JSONDecoder().decode(RolledBackRecord.self, from: $0)
        }
    }

    static func makeBundle(_ app: URL, version: String, identifier: String = "com.taalcut.app") {
        let contents = app.appendingPathComponent("Contents")
        try? FileManager.default.createDirectory(at: contents.appendingPathComponent("MacOS"), withIntermediateDirectories: true)
        let plist = ["CFBundleShortVersionString": version, "CFBundleIdentifier": identifier]
        let data = try? PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try? data?.write(to: contents.appendingPathComponent("Info.plist"))
        try? Data("#!/bin/sh\n".utf8).write(to: contents.appendingPathComponent("MacOS/Taalcut"))
    }
}

/// The guard's ports over the fakes, plus the fakes for assertions.
struct GuardWorld {
    let clock = FakeClock()
    let processes: ScriptedProcesses
    let signals: FakeSignals
    let launcher = FakeLauncher()
    let log = CollectingLog()
    var bundleId = BuildStamp.appBundleId

    init(ignoresTerminate: Bool = false) {
        processes = ScriptedProcesses(clock: clock)
        signals = FakeSignals(processes: processes, ignoresTerminate: ignoresTerminate)
    }

    var ports: GuardPorts {
        GuardPorts(
            clock: clock, processes: processes, signals: signals, launcher: launcher, log: log, files: .default, bundleId: bundleId)
    }

    func run(_ sandbox: GuardSandbox, _ extra: [String] = []) -> Int32 {
        GuardCommand.run(["--pending", sandbox.pendingFile.path, "--poll-ms", "500"] + extra, ports: ports)
    }
}
