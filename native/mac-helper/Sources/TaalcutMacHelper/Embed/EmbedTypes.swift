// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreML
import Foundation

/// The `embeddinggemma-2-coreml` component's files (`--models`): compiled models, so nothing compiles from an
/// .mlpackage on the user's Mac; only Core ML's own per-device step runs at the first load. The token table is
/// `embeddings.q4` (IX3-N1), or `embeddings.f16` in a component packed before it.
struct EmbedModelFiles: Sendable {
    let textModel: URL
    let visionModel: URL
    let tokenTableQ4: URL
    let tokenTable: URL
    let positionTable: URL

    init(directory: URL) {
        textModel = directory.appendingPathComponent("EmbeddingGemma2Text.mlmodelc")
        visionModel = directory.appendingPathComponent("EmbeddingGemma2Vision.mlmodelc")
        tokenTableQ4 = directory.appendingPathComponent("embeddings.q4")
        tokenTable = directory.appendingPathComponent("embeddings.f16")
        positionTable = directory.appendingPathComponent("position_embeddings.f16")
    }

    var missing: [String] {
        let exists = { (url: URL) in FileManager.default.fileExists(atPath: url.path) }
        // A component packed before IX3 has only embeddings.f16; any other names embeddings.q4 when it is missing.
        let table = exists(tokenTable) && !exists(tokenTableQ4) ? tokenTable : tokenTableQ4
        return [textModel, visionModel, table, positionTable].filter { !exists($0) }.map(\.lastPathComponent)
    }
}

/// Where each half runs (measured, vision SPEC "Core ML backend"): the vision encoder on the GPU (its attention
/// over every patch is quicker there than on the Neural Engine), the text model on the Neural Engine.
enum EmbedUnits {
    static let vision: MLComputeUnits = .cpuAndGPU
    static let text: MLComputeUnits = .cpuAndNeuralEngine
    static let names: JSONValue = .object(["vision": .string("cpuAndGPU"), "text": .string("cpuAndNeuralEngine")])
}

/// The soft-token budgets the vision package has a function for.
let embedBudgets = [70, 140, 280]
/// Gemma 4's vision patch side in pixels, and the patches per side of one pooled soft token.
let embedPatch = 16
let embedPooling = 3

/// One rgb24 frame at its budget's processor size.
struct EmbedFrame: Sendable {
    let width: Int
    let height: Int
    let rgb: Data
}

enum EmbedError: Error, Sendable {
    case invalidModel(String)
    case tooLong(Int)
    case badFrame(String)
    case badOutput(String)

    var failure: HelperFailure {
        switch self {
        case .invalidModel(let detail):
            return .failed("embed.model_load_failed", detail, retryable: false)
        case .tooLong(let count):
            return .badRequest("\(count) tokens do not fit the longest text function (512)")
        case .badFrame(let detail):
            return .badRequest(detail)
        case .badOutput(let name):
            return .failed("embed.failed", "the model gave no \(name)", retryable: true)
        }
    }
}
