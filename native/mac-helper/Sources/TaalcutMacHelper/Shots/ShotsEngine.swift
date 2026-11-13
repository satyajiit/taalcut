// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// The `shots` service's methods (IX2-S9): `shots.prepare` and `shots.windows`, TransNetV2 on Core ML from the
/// `transnetv2-coreml` component (`--models`). Its own process, like `embed`.
protocol ShotsService: Sendable {
    func handle(method: String, params: JSONValue, confinement: PathConfinement) async -> WorkResponse
}

func makeShotsService(modelsDirectory: URL) -> any ShotsService {
    CoreMLShotsService(engine: ShotsEngine(modelsDirectory: modelsDirectory))
}

struct CoreMLShotsService: ShotsService {
    let engine: ShotsEngine

    func handle(method: String, params: JSONValue, confinement: PathConfinement) async -> WorkResponse {
        switch method {
        case "shots.prepare": return await engine.prepare(params)
        case "shots.windows": return await engine.windows(params, confinement: confinement)
        default: return .fail(.unknownMethod(method))
        }
    }
}

/// The actor only loads (once per compute units, on `shots.prepare` or the first window); predictions run in each
/// request's task, so the two requests the service runs at once overlap.
actor ShotsEngine {
    private let directory: URL
    private var models: [ShotsUnits: Task<ShotsModel, Error>] = [:]

    init(modelsDirectory: URL) {
        directory = modelsDirectory
    }

    /// Loads the model on `computeUnits`. The first load on a Mac adds Core ML's per-device step (0.3–3 s measured).
    func prepare(_ params: JSONValue) async -> WorkResponse {
        let units: ShotsUnits
        switch shotsUnitsParam(params) {
        case .success(let value): units = value
        case .failure(let failure): return .fail(failure)
        }
        let started = ContinuousClock.now
        do {
            _ = try await model(units)
        } catch {
            return .fail(loadFailure(error))
        }
        let elapsed = ContinuousClock.now - started
        let loadMs = (Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15)
        return .ok(.object([
            "loadMs": .number(loadMs.rounded()),
            "computeUnits": .string(units.rawValue),
            "model": .string(ShotsWindow.modelFile),
        ]))
    }

    /// `{ single, manyHot }`: base64 float32, `count` × 100 values each, window after window.
    func windows(_ params: JSONValue, confinement: PathConfinement) async -> WorkResponse {
        let request: ShotsWindowsRequest
        switch ShotsWindowsRequest.parse(params, confinement: confinement) {
        case .success(let value): request = value
        case .failure(let failure): return .fail(failure)
        }
        let frames: Data
        switch request.frames() {
        case .success(let value): frames = value
        case .failure(let failure): return .fail(failure)
        }
        let loaded: ShotsModel
        do {
            loaded = try await model(request.units)
        } catch {
            return .fail(loadFailure(error))
        }
        do {
            var single: [Float] = []
            var manyHot: [Float] = []
            for index in 0..<request.count {
                try Task.checkCancellation()
                let out = try await loaded.predict(window: shotsWindow(frames, index))
                single += out.single
                manyHot += out.manyHot
            }
            // Base64 of little-endian float32, as the embed service's vectors.
            return .ok(.object(["single": encodeVector(single), "manyHot": encodeVector(manyHot)]))
        } catch let error as ShotsError {
            return .fail(error.failure)
        } catch is CancellationError {
            return .fail(.cancelled)
        } catch {
            return .fail(.failed("shots.failed", String(describing: error), retryable: true))
        }
    }

    /// One load per compute units, however many requests wait for it; a failed load is tried again next time.
    private func model(_ units: ShotsUnits) async throws -> ShotsModel {
        let task = models[units] ?? Task { [directory] in try await ShotsModel.load(directory: directory, units: units) }
        models[units] = task
        do {
            return try await task.value
        } catch {
            models[units] = nil
            throw error
        }
    }

    private func loadFailure(_ error: Error) -> HelperFailure {
        if let shots = error as? ShotsError { return shots.failure }
        return .failed("shots.model_load_failed", String(describing: error), retryable: false)
    }
}
