// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// The `taalcut` executable `swift test` built next to the test bundle.
func builtTaalcut() -> URL? {
    for bundle in Bundle.allBundles where bundle.bundlePath.hasSuffix(".xctest") {
        let candidate = bundle.bundleURL.deletingLastPathComponent().appendingPathComponent("taalcut")
        if FileManager.default.isExecutableFile(atPath: candidate.path) { return candidate }
    }
    let packageRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    let fallback = packageRoot.appendingPathComponent(".build/debug/taalcut")
    return FileManager.default.isExecutableFile(atPath: fallback.path) ? fallback : nil
}

struct ProcessOutput {
    let status: Int32
    let stdout: String
    let stderr: String
}

/// Runs the binary with `input` on a stdin pipe (closed after writing) and a minimal environment.
func runTaalcut(_ binary: URL, _ arguments: [String], environment: [String: String], input: String = "") async throws -> ProcessOutput {
    let process = Process()
    process.executableURL = binary
    process.arguments = arguments
    process.environment = environment
    let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
    process.standardInput = stdin
    process.standardOutput = stdout
    process.standardError = stderr
    try process.run()
    stdin.fileHandleForWriting.write(Data(input.utf8))
    try stdin.fileHandleForWriting.close()
    // Read before waiting, so a full pipe never blocks the child.
    async let out = Task.detached { stdout.fileHandleForReading.readDataToEndOfFile() }.value
    async let err = Task.detached { stderr.fileHandleForReading.readDataToEndOfFile() }.value
    let (outData, errData) = await (out, err)
    process.waitUntilExit()
    return ProcessOutput(
        status: process.terminationStatus,
        stdout: String(decoding: outData, as: UTF8.self),
        stderr: String(decoding: errData, as: UTF8.self)
    )
}
