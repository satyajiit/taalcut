// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

@preconcurrency import CoreML
import Foundation

/// The `embed` service's work (IX2-E3/E5): EmbeddingGemma 2 on Core ML from the `embeddinggemma-2-coreml`
/// component (`--models`). The actor only loads (once, on first use or `embed.prepare`); predictions run in each
/// request's task, so two requests overlap: one frame's vision function on the GPU while another's text pass is
/// on the Neural Engine. Needs macOS 15 (multifunction models).
@available(macOS 15, *)
actor EmbedEngine {
    private let files: EmbedModelFiles
    private var text: Task<EmbedTextModel, Error>?
    private var vision: [Int: Task<EmbedVisionModel, Error>] = [:]

    init(modelsDirectory: URL) {
        files = EmbedModelFiles(directory: modelsDirectory)
    }

    /// Loads the text functions and the vision functions of `budgets`. The first load on a Mac is Core ML's
    /// per-device step (minutes for the Neural Engine's six text functions; measured in the vision SPEC), so the app
    /// runs this when the component is installed or the embedder warms, never on an import's critical path. A text
    /// or frame request meanwhile waits only for the functions it uses (`EmbedTextFunctions`).
    func prepare(_ params: JSONValue) async -> WorkResponse {
        let budgets: [Int]
        switch embedBudgetsParam(params) {
        case .success(let value): budgets = value
        case .failure(let failure): return .fail(failure)
        }
        let started = ContinuousClock.now
        do {
            try await textModel().loadAll()
            for budget in budgets { _ = try await visionModel(budget) }
        } catch {
            return .fail(loadFailure(error))
        }
        return .ok(.object([
            "loadMs": .number(milliseconds(since: started)),
            "budgets": .array(budgets.map { .number(Double($0)) }),
            "computeUnits": EmbedUnits.names,
        ]))
    }

    func images(_ params: JSONValue, confinement: PathConfinement) async -> WorkResponse {
        let request: EmbedImagesRequest
        switch EmbedImagesRequest.parse(params, confinement: confinement) {
        case .success(let value): request = value
        case .failure(let failure): return .fail(failure)
        }
        let models: (EmbedTextModel, EmbedVisionModel)
        do {
            models = (try await textModel(), try await visionModel(request.tokens))
        } catch {
            return .fail(loadFailure(error))
        }
        do {
            // Two stages: frame i's text pass (Neural Engine) runs while frame i + 1's vision pass (GPU) does.
            var vectors: [JSONValue] = []
            var text: Task<[Float], Error>?
            for frame in try request.frames() {
                try Task.checkCancellation()
                let soft = try await models.1.run(frame: frame)
                if let previous = text { vectors.append(encodeVector(try await previous.value)) }
                text = Task { [model = models.0] in try await model.embed(imageTokens: soft.tokens, count: soft.count) }
            }
            if let last = text { vectors.append(encodeVector(try await last.value)) }
            return .ok(.object(["vectors": .array(vectors)]))
        } catch let error as EmbedError {
            return .fail(error.failure)
        } catch is CancellationError {
            return .fail(.cancelled)
        } catch {
            return .fail(.failed("embed.failed", String(describing: error), retryable: true))
        }
    }

    func texts(_ params: JSONValue) async -> WorkResponse {
        let ids: [[Int32]]
        switch embedIdsParam(params) {
        case .success(let value): ids = value
        case .failure(let failure): return .fail(failure)
        }
        let model: EmbedTextModel
        do {
            model = try await textModel()
        } catch {
            return .fail(loadFailure(error))
        }
        do {
            var vectors: [JSONValue] = []
            for sequence in ids {
                try Task.checkCancellation()
                vectors.append(encodeVector(try await model.embed(ids: sequence)))
            }
            return .ok(.object(["vectors": .array(vectors)]))
        } catch let error as EmbedError {
            return .fail(error.failure)
        } catch is CancellationError {
            return .fail(.cancelled)
        } catch {
            return .fail(.failed("embed.failed", String(describing: error), retryable: true))
        }
    }

    private func textModel() async throws -> EmbedTextModel {
        try await loadOnce(text, { self.text = $0 }) { [files] in
            try EmbedTextModel.load(files: files, units: EmbedUnits.text)
        }
    }

    private func visionModel(_ tokens: Int) async throws -> EmbedVisionModel {
        try await loadOnce(vision[tokens], { self.vision[tokens] = $0 }) { [files] in
            try await EmbedVisionModel.load(files: files, tokens: tokens, units: EmbedUnits.vision)
        }
    }

    /// One load per model, however many requests wait for it; a failed load is tried again next time.
    private func loadOnce<Model: Sendable>(
        _ current: Task<Model, Error>?, _ store: (Task<Model, Error>?) -> Void,
        load: @escaping @Sendable () async throws -> Model
    ) async throws -> Model {
        if let missing = files.missing.first { throw EmbedError.invalidModel("\(missing) is not in the models directory") }
        let task = current ?? Task { try await load() }
        store(task)
        do {
            return try await task.value
        } catch {
            store(nil)
            throw error
        }
    }

    private func loadFailure(_ error: Error) -> HelperFailure {
        if let embed = error as? EmbedError { return embed.failure }
        return .failed("embed.model_load_failed", String(describing: error), retryable: false)
    }
}

private func milliseconds(since start: ContinuousClock.Instant) -> Double {
    let elapsed = ContinuousClock.now - start
    return (Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15).rounded()
}

/// A vector as base64 of its 768 little-endian float32 values (exact, and a third the size of JSON numbers).
func encodeVector(_ vector: [Float]) -> JSONValue {
    let data = vector.withUnsafeBufferPointer { Data(buffer: $0) }
    return .string(data.base64EncodedString())
}
