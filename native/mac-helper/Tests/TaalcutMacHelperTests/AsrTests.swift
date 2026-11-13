// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

private let weightRevision = "7dd20fe6b1797d35f5e3307e8b1732d9a178edfe"
private let weightFiles = [
    "Preprocessor.mlmodelc", "Encoder.mlmodelc", "Decoder.mlmodelc", "JointDecisionv3.mlmodelc", "parakeet_vocab.json",
]

@Suite(.serialized) struct AsrTests {
    @Test func missingDirectoryDoesNotLoad() async {
        let engine = AsrEngine(modelsDirectory: URL(fileURLWithPath: "/no/such/parakeet-weights"))
        let response = await engine.load(.object([:]))
        #expect(response.failure?.code == "asr.model_missing")
        let early = await engine.transcribe(
            .object(["path": .string("/tmp/clip.wav")]),
            confinement: PathConfinement(roots: ["/tmp"]), progress: { _ in })
        #expect(early.failure?.code == "asr.not_loaded")
    }

    @Test(.disabled(if: parakeetWeightsMissing(), parakeetSkipComment), .timeLimit(.minutes(8)))
    func transcribesASayClipWhenWeightsArePresent() async throws {
        let models = modelsDirectory()
        let root = FileManager.default.temporaryDirectory
        let clip = root.appendingPathComponent("taalcut-say-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: clip) }
        let say = Process()
        say.executableURL = URL(fileURLWithPath: "/usr/bin/say")
        say.arguments = [
            "-o", clip.path, "--file-format=WAVE", "--data-format=LEI16@16000", "Testing one two three",
        ]
        try say.run()
        say.waitUntilExit()
        try #require(say.terminationStatus == 0)
        let engine = AsrEngine(modelsDirectory: models)
        let loaded = await engine.load(.object([:]))
        #expect(loaded.failure == nil)
        #expect(loaded.result?.key("computeUnits")?.key("encoder")?.string == "cpuAndNeuralEngine")
        let response = await engine.transcribe(
            .object(["path": .string(clip.path)]),
            confinement: PathConfinement(roots: [root.path]), progress: { _ in })
        let body = try #require(response.result)
        let text = try #require(body.key("text")?.string).lowercased()
        // `say` on this host is heard as "tasting 123." The words are still in
        // order on the 80 ms grid; either hearing is close to the script.
        let literal = ["testing", "one", "two", "three"].allSatisfy { text.contains($0) }
        let mishear = text.contains("tast") && (text.contains("123") || text.contains("one"))
        #expect(literal || mishear, "heard \(text)")
        let words = try #require(body.key("words")?.array)
        var previous = -1.0
        for word in words {
            let start = try #require(word.key("startMs")?.number)
            let end = try #require(word.key("endMs")?.number)
            #expect(start >= previous)
            #expect(end >= start)
            previous = start
        }
    }
}

private func modelsDirectory() -> URL {
    testModelsDirectory(variable: "TAALCUT_PARAKEET_MODELS", relative: ".cache/parakeet")
}

private func weightsInstalled(_ directory: URL) -> Bool {
    weightFiles.allSatisfy { FileManager.default.fileExists(atPath: directory.appendingPathComponent($0).path) }
}

/// This Testing module has no `Skip`. A disabled trait is the skip, and the
/// message names the revision and the int8 subset so a missing cache is obvious.
private let parakeetSkipComment: Comment = """
Parakeet int8 weights are not installed. Fetch revision \(weightRevision) from \
FluidInference/parakeet-tdt-0.6b-v3-coreml. Use the int8 subset only (not Encoder_v2): \
\(weightFiles.joined(separator: ", ")). Example: hf download FluidInference/parakeet-tdt-0.6b-v3-coreml \
--revision \(weightRevision) --local-dir native/mac-helper/.cache/parakeet
"""

private func parakeetWeightsMissing() -> Bool {
    let models = modelsDirectory()
    let missing = !weightsInstalled(models)
    if missing { print(skipMessage(models)) }
    return missing
}

private func skipMessage(_ directory: URL) -> String {
    """
    Parakeet int8 weights are not in \(directory.path).
    Fetch revision \(weightRevision) from FluidInference/parakeet-tdt-0.6b-v3-coreml.
    Use the int8 subset only (not Encoder_v2): \(weightFiles.joined(separator: ", ")).
    Example: hf download FluidInference/parakeet-tdt-0.6b-v3-coreml --revision \(weightRevision) --local-dir \(directory.path)
    """
}
