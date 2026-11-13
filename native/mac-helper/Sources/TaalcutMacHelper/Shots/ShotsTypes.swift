// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

@preconcurrency import CoreML
import Foundation

/// TransNetV2's window (IX2-S9): 100 frames of 48×27 rgb24, back to back, and the model file of the
/// `transnetv2-coreml` component (`--models`).
enum ShotsWindow {
    static let frames = 100
    static let width = 48
    static let height = 27
    static let bytes = frames * height * width * 3
    static let modelFile = "TransNetV2.mlmodelc"
}

/// Windows one `shots.windows` request's file holds at most (1.6 MB).
let shotsRequestLimit = 4

/// Where the model runs, by the name a request gives (`computeUnits`). The default is the GPU: its predictions are
/// the ONNX model's to 1e-6 (fp32; the Neural Engine computes in fp16), at 8.5 ms a window on an M5 Max (vision
/// SPEC, "Shot boundaries on Core ML").
enum ShotsUnits: String, Sendable, CaseIterable {
    case cpuAndGPU
    case cpuAndNeuralEngine
    case cpuOnly
    case all

    static let standard = ShotsUnits.cpuAndGPU

    var computeUnits: MLComputeUnits {
        switch self {
        case .cpuAndGPU: return .cpuAndGPU
        case .cpuAndNeuralEngine: return .cpuAndNeuralEngine
        case .cpuOnly: return .cpuOnly
        case .all: return .all
        }
    }
}

enum ShotsError: Error, Sendable {
    case invalidModel(String)
    case badOutput(String)

    var failure: HelperFailure {
        switch self {
        case .invalidModel(let detail):
            return .failed("shots.model_load_failed", detail, retryable: false)
        case .badOutput(let name):
            return .failed("shots.failed", "the model gave no \(name)", retryable: true)
        }
    }
}
