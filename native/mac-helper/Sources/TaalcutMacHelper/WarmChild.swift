// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Each OCR warm-up step runs in a child process of this build (FIX-OCRCOLD). While a process compiles a Vision
/// model, every read in that process waits for the compile: measured on macOS 27.2, a Latin read whose models were
/// compiled, sent 3 s into a Devanagari compile, took 25.8 s; the same read in another process of the same build,
/// 3 s into a 58 s Arabic compile, took 0.44 s. The child shares this build's cache of compiled models (CacheScope),
/// so what it compiles, the serving process reads warm.
enum WarmChild {
    /// `taalcut-mac-helper ocr-warm-step <script>`: reads one warm-up canvas and prints one line, `{"lines":N}` or
    /// `{"error":"<code>"}`.
    static let command = "ocr-warm-step"

    /// The child's side: one step, read as the warm-up reads it. The line to print and the exit status.
    static func runStep(script: String, forceLegacy: Bool) async -> (line: JSONValue, status: Int32) {
        let engine = OcrEngine(forceLegacy: forceLegacy)
        let steps = warmSteps(supported: engine.supportedIdentifiers(fast: false))
        guard let step = steps.first(where: { $0.script == script }) else {
            return (.object(["error": .string("bad_request")]), 2)
        }
        guard let canvas = warmCanvas(step) else {
            return (.object(["error": .string("ocr.failed")]), 1)
        }
        switch await engine.warm(canvas, languages: step.languages) {
        case .success(let lines): return (.object(["lines": .number(Double(lines))]), 0)
        case .failure(let failure): return (.object(["error": .string(failure.code)]), 1)
        }
    }

    /// The parent's side: a warm-up reader that runs each step in a child of `executable` at utility priority.
    static func reader(executable: URL, forceLegacy: Bool) -> OcrWarmup.Reader {
        { step in
            await withCheckedContinuation { continuation in
                let process = Process()
                process.executableURL = executable
                process.arguments = [command, step.script] + (forceLegacy ? ["--force-legacy-ocr"] : [])
                process.qualityOfService = .utility
                let output = Pipe()
                process.standardOutput = output
                process.standardError = FileHandle.nullDevice
                process.standardInput = FileHandle.nullDevice
                process.terminationHandler = { _ in
                    continuation.resume(returning: parse(output.fileHandleForReading.readDataToEndOfFile()))
                }
                do {
                    try process.run()
                } catch {
                    continuation.resume(returning: .failure(
                        .failed("ocr.failed", "the warm-up step could not start", retryable: true)))
                }
            }
        }
    }

    /// The child's line, as the warm-up's result: the lines read, or the child's failure code.
    static func parse(_ data: Data) -> Result<Int, HelperFailure> {
        let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let line = text.split(separator: "\n").last, let value = JSONValue.parse(line: String(line)) else {
            return .failure(.failed("ocr.failed", "the warm-up step said nothing", retryable: true))
        }
        if let lines = value.key("lines")?.number { return .success(Int(lines)) }
        let code = value.key("error")?.string ?? "ocr.failed"
        return .failure(.failed(code, "the warm-up step failed", retryable: true))
    }
}
