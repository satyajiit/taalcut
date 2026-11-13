// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

@preconcurrency import CoreML
import Foundation

/// TransNetV2 on Core ML (IX2-S9): the `transnetv2-coreml` component's compiled model, input `frames` float32
/// [1, 100, 27, 48, 3] in 0–255, outputs `single` and `many_hot` [1, 100, 1] after the sigmoid (the ONNX model's
/// input and outputs). Immutable after load; Core ML runs one model's predictions from several tasks.
final class ShotsModel: @unchecked Sendable {
    let units: ShotsUnits
    private let model: MLModel

    private init(model: MLModel, units: ShotsUnits) {
        self.model = model
        self.units = units
    }

    static func load(directory: URL, units: ShotsUnits) async throws -> ShotsModel {
        let url = directory.appendingPathComponent(ShotsWindow.modelFile)
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw ShotsError.invalidModel("\(ShotsWindow.modelFile) is not in the models directory")
        }
        let configuration = MLModelConfiguration()
        configuration.computeUnits = units.computeUnits
        let model = try await MLModel.load(contentsOf: url, configuration: configuration)
        return ShotsModel(model: model, units: units)
    }

    /// One window's probabilities: the single-frame head and the many-hot head, 100 each.
    func predict(window: Data) async throws -> (single: [Float], manyHot: [Float]) {
        let input = try MLMultiArray(
            shape: [1, NSNumber(value: ShotsWindow.frames), NSNumber(value: ShotsWindow.height),
                NSNumber(value: ShotsWindow.width), 3],
            dataType: .float32)
        let target = input.dataPointer.assumingMemoryBound(to: Float.self)
        window.withUnsafeBytes { raw in
            let bytes = raw.bindMemory(to: UInt8.self)
            for index in 0..<ShotsWindow.bytes { target[index] = Float(bytes[index]) }
        }
        let provider = try MLDictionaryFeatureProvider(dictionary: ["frames": MLFeatureValue(multiArray: input)])
        let output = try await model.prediction(from: provider)
        return (try head(output, "single"), try head(output, "many_hot"))
    }

    /// An output's 100 values, read through its strides (a GPU output may be padded) and its data type.
    private func head(_ output: MLFeatureProvider, _ name: String) throws -> [Float] {
        guard let array = output.featureValue(for: name)?.multiArrayValue, array.shape.count == 3,
            array.shape[1].intValue == ShotsWindow.frames
        else { throw ShotsError.badOutput(name) }
        let stride = array.strides[1].intValue
        switch array.dataType {
        case .float32:
            let pointer = array.dataPointer.assumingMemoryBound(to: Float.self)
            return (0..<ShotsWindow.frames).map { pointer[$0 * stride] }
        case .float16:
            let pointer = array.dataPointer.assumingMemoryBound(to: Float16.self)
            return (0..<ShotsWindow.frames).map { Float(pointer[$0 * stride]) }
        default:
            throw ShotsError.badOutput(name)
        }
    }
}
