// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import AVFoundation
import CoreML
import FluidAudio
import Foundation

/// Parakeet TDT v3 through FluidAudio `AsrModels.loadLocal` only. This process
/// never downloads weights and never calls a text-to-speech path.
actor AsrEngine {
    private let modelsDirectory: URL
    private var manager: AsrManager?

    init(modelsDirectory: URL) {
        self.modelsDirectory = modelsDirectory
    }

    func load(_ params: JSONValue) async -> WorkResponse {
        guard let object = params.object else {
            return .fail(.badRequest("params must be an object"))
        }
        let version = object["version"]?.string ?? "v3"
        let precision = object["encoderPrecision"]?.string ?? "int8"
        guard version == "v3", precision == "int8" else {
            return .fail(.badRequest("only version v3 and encoderPrecision int8 are supported"))
        }
        guard componentsPresent() else {
            return .fail(.failed("asr.model_missing", "parakeet weights are not in the models directory", retryable: false))
        }
        let started = Date()
        let models: AsrModels
        do {
            models = try await loadLocalModels(from: modelsDirectory)
        } catch let error as AsrModelsError {
            if case .modelNotFound = error {
                return .fail(.failed("asr.model_missing", "parakeet weights are not in the models directory", retryable: false))
            }
            return .fail(.failed("asr.model_load_failed", "parakeet weights failed to load", retryable: false))
        } catch {
            return .fail(.failed("asr.model_load_failed", "parakeet weights failed to load", retryable: false))
        }
        let loaded = AsrManager()
        do {
            try await loaded.loadModels(models)
        } catch {
            return .fail(.failed("asr.model_load_failed", "parakeet weights failed to load", retryable: false))
        }
        manager = loaded
        let loadMs = Int(Date().timeIntervalSince(started) * 1000)
        return .ok(.object([
            "loadMs": .number(Double(loadMs)),
            "computeUnits": .object([
                "preprocessor": .string("cpuOnly"),
                "encoder": .string("cpuAndNeuralEngine"),
                "decoder": .string("cpuAndNeuralEngine"),
                "joint": .string("cpuAndNeuralEngine"),
            ]),
        ]))
    }

    func transcribe(
        _ params: JSONValue, confinement: PathConfinement, progress: @escaping @Sendable (Double) -> Void
    ) async -> WorkResponse {
        guard let manager else {
            return .fail(.failed("asr.not_loaded", "asr.load has not succeeded", retryable: false))
        }
        guard let object = params.object, let path = object["path"]?.string else {
            return .fail(.badRequest("missing path"))
        }
        let language: Language?
        if let hint = object["language"] {
            guard let code = hint.string, let parsed = Language(rawValue: code) else {
                return .fail(.badRequest("unknown language"))
            }
            language = parsed
        } else {
            language = nil
        }
        switch confinement.resolve(path) {
        case .failure(let failure):
            return .fail(failure)
        case .success(let url):
            let seconds: Double
            do {
                seconds = try audioSeconds(url)
            } catch {
                return .fail(.failed("asr.audio_unreadable", "audio could not be read", retryable: false))
            }
            let progressTask = await progressTask(seconds: seconds, manager: manager, progress: progress)
            defer { progressTask?.cancel() }
            var state = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
            do {
                let result = try await manager.transcribe(url, decoderState: &state, language: language)
                return .ok(transcriptJSON(result))
            } catch ASRError.notInitialized {
                return .fail(.failed("asr.not_loaded", "asr.load has not succeeded", retryable: false))
            } catch ASRError.invalidAudioData {
                return .fail(.failed("asr.audio_unreadable", "audio could not be read", retryable: false))
            } catch {
                return .fail(.failed("asr.failed", "transcription failed", retryable: true))
            }
        }
    }

    /// The five int8 v3 files, in this directory. `AsrModels.modelsExist` looks
    /// beside the directory, which is the FluidAudio cache layout, not ours.
    private func componentsPresent() -> Bool {
        let names = [
            ModelNames.ASR.preprocessorFile,
            ParakeetEncoderPrecision.int8.encoderFileName,
            ModelNames.ASR.decoderFile,
            ModelNames.ASR.jointV3File,
            ModelNames.ASR.vocabularyFile,
        ]
        return names.allSatisfy { name in
            FileManager.default.fileExists(atPath: modelsDirectory.appendingPathComponent(name).path)
        }
    }
}

@concurrent
private func loadLocalModels(from directory: URL) async throws -> AsrModels {
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .cpuAndNeuralEngine
    return try AsrModels.loadLocal(
        from: directory, version: .v3, configuration: configuration, encoderPrecision: .int8)
}

private func audioSeconds(_ url: URL) throws -> Double {
    let file = try AVAudioFile(forReading: url)
    let rate = file.processingFormat.sampleRate
    guard rate > 0 else { throw ASRError.invalidAudioData }
    return Double(file.length) / rate
}

private func progressTask(
    seconds: Double, manager: AsrManager, progress: @escaping @Sendable (Double) -> Void
) async -> Task<Void, Never>? {
    guard seconds > 30 else { return nil }
    let stream = await manager.transcriptionProgressStream
    return Task {
        do {
            for try await fraction in stream {
                if Task.isCancelled { break }
                progress(fraction)
            }
        } catch {
            return
        }
    }
}

private func transcriptJSON(_ result: ASRResult) -> JSONValue {
    let tokens = result.tokenTimings ?? []
    let built = buildWordTimings(from: tokens)
    let confidences = wordConfidences(tokens)
    let fallback = Double(result.confidence)
    let matched = confidences.count == built.count
    let duration = result.duration
    let rtf = duration > 0 ? result.processingTime / duration : 0
    return .object([
        "text": .string(result.text),
        "durationMs": .number(Double(milliseconds(duration))),
        "rtf": .number(rtf),
        "words": .array(built.enumerated().map { index, word in
            .object([
                "text": .string(word.word),
                "startMs": .number(Double(milliseconds(word.startTime))),
                "endMs": .number(Double(milliseconds(word.endTime))),
                "confidence": .number(matched ? confidences[index] : fallback),
            ])
        }),
    ])
}

/// Same grouping as `buildWordTimings`: a token that starts with a space or
/// U+2581 begins a word. Confidence is the mean of that word's tokens.
private func wordConfidences(_ tokens: [TokenTiming]) -> [Double] {
    var averages: [Double] = []
    var scores: [Float] = []
    var current = ""
    func flush() {
        let trimmed = current.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        let mean = scores.isEmpty ? 0 : Double(scores.reduce(0, +)) / Double(scores.count)
        averages.append(mean)
    }
    for timing in tokens {
        let token = timing.token
        if token.isEmpty || token == "<blank>" || token == "<pad>" { continue }
        let startsNewWord = isWordBoundary(token) || current.isEmpty
        if startsNewWord && !current.isEmpty {
            flush()
            current = ""
            scores = []
        }
        if startsNewWord {
            current = stripWordBoundaryPrefix(token)
            scores = [timing.confidence]
        } else {
            current += token
            scores.append(timing.confidence)
        }
    }
    flush()
    return averages
}

private func milliseconds(_ seconds: TimeInterval) -> Int {
    Int((seconds * 1000).rounded())
}
