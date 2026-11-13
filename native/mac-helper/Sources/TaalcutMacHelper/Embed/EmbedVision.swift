// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

@preconcurrency import CoreML
import Foundation

/// One of EmbeddingGemma 2's vision functions on Core ML (`vision_70`, `vision_140`, `vision_280`: one fixed shape
/// per soft-token budget). A frame arrives as rgb24 already at the Gemma 4 image processor's size for its budget
/// (sides a multiple of 48), so it is cut into 16 px patches here exactly as transformers.js cuts it: patches row
/// by row, each `[16 rows][16 cols][RGB]` scaled to 0–1, positions `(x, y)`, padding at −1. The position
/// embeddings are `table[0][x] + table[1][y]` from `position_embeddings.f16`, and `pool` averages each 3×3 block of
/// patches into one soft token, row by row. Immutable after load (see EmbedTextModel).
@available(macOS 15, *)
final class EmbedVisionModel: @unchecked Sendable {
    static let patch = embedPatch
    static let pooling = embedPooling
    static let patchWidth = patch * patch * 3
    static let positionWidth = 768
    static let tableRows = 1024

    let tokens: Int
    let patches: Int
    private let model: MLModel
    private let positionTable: Data
    private let lock = NSLock()
    private var geometryCache: [String: (positions: MLFeatureValue, embeddings: MLFeatureValue, valid: MLFeatureValue, pool: MLFeatureValue)] = [:]

    private init(model: MLModel, tokens: Int, positionTable: Data) {
        self.model = model
        self.tokens = tokens
        patches = tokens * Self.pooling * Self.pooling
        self.positionTable = positionTable
    }

    static func load(files: EmbedModelFiles, tokens: Int, units: MLComputeUnits) async throws -> EmbedVisionModel {
        let table = try Data(contentsOf: files.positionTable)
        guard table.count == 2 * tableRows * positionWidth * 2 else {
            throw EmbedError.invalidModel("position_embeddings.f16 is not two \(tableRows)×\(positionWidth) fp16 tables")
        }
        let model = try await loadFunction(files.visionModel, name: "vision_\(tokens)", units: units)
        return EmbedVisionModel(model: model, tokens: tokens, positionTable: table)
    }

    /// The frame's soft tokens (`image_tokens`) and how many of them are real.
    func run(frame: EmbedFrame) async throws -> (tokens: MLMultiArray, count: Int) {
        let across = frame.width / Self.patch
        let down = frame.height / Self.patch
        guard across * down <= patches else { throw EmbedError.badFrame("\(frame.width)x\(frame.height) is over \(tokens) tokens") }
        let input = try inputs(frame, across: across, down: down)
        let output = try await model.prediction(from: input)
        guard let soft = output.featureValue(for: "image_tokens")?.multiArrayValue else {
            throw EmbedError.badOutput("image_tokens")
        }
        return (soft, (across / Self.pooling) * (down / Self.pooling))
    }

    private func geometry(across: Int, down: Int) throws -> (positions: MLFeatureValue, embeddings: MLFeatureValue, valid: MLFeatureValue, pool: MLFeatureValue) {
        let key = "\(across)x\(down)"
        lock.lock()
        if let cached = geometryCache[key] {
            lock.unlock()
            return cached
        }
        lock.unlock()
        let n = NSNumber(value: patches)
        let positions = try zeroed([1, n, 2])
        let embeddings = try zeroed([1, n, NSNumber(value: Self.positionWidth)])
        let valid = try zeroed([1, n])
        let pool = try zeroed([NSNumber(value: tokens), n])
        let pos = positions.dataPointer.assumingMemoryBound(to: Float16.self)
        let pe = embeddings.dataPointer.assumingMemoryBound(to: Float16.self)
        let ok = valid.dataPointer.assumingMemoryBound(to: Float16.self)
        let pl = pool.dataPointer.assumingMemoryBound(to: Float16.self)
        for index in 0..<(2 * patches) { pos[index] = -1 }
        let blocksAcross = across / Self.pooling
        let ninth = Float16(1.0 / 9.0)
        positionTable.withUnsafeBytes { tableRaw in
            let table = tableRaw.bindMemory(to: Float16.self)
            for y in 0..<down {
                for x in 0..<across {
                    let index = y * across + x
                    pos[index * 2] = Float16(Float(x))
                    pos[index * 2 + 1] = Float16(Float(y))
                    let tx = x * Self.positionWidth
                    let ty = (Self.tableRows + y) * Self.positionWidth
                    let target = index * Self.positionWidth
                    for c in 0..<Self.positionWidth { pe[target + c] = Float16(Float(table[tx + c]) + Float(table[ty + c])) }
                    ok[index] = 1
                    let token = (y / Self.pooling) * blocksAcross + x / Self.pooling
                    pl[token * patches + index] = ninth
                }
            }
        }
        let built = (
            positions: MLFeatureValue(multiArray: positions),
            embeddings: MLFeatureValue(multiArray: embeddings),
            valid: MLFeatureValue(multiArray: valid),
            pool: MLFeatureValue(multiArray: pool)
        )
        lock.lock()
        geometryCache[key] = built
        lock.unlock()
        return built
    }

    private func inputs(_ frame: EmbedFrame, across: Int, down: Int) throws -> MLFeatureProvider {
        let n = NSNumber(value: patches)
        let pixels = try zeroed([1, n, NSNumber(value: Self.patchWidth)])
        let px = pixels.dataPointer.assumingMemoryBound(to: Float16.self)
        frame.rgb.withUnsafeBytes { raw in
            let bytes = raw.bindMemory(to: UInt8.self)
            for y in 0..<down {
                for x in 0..<across {
                    let index = y * across + x
                    var out = index * Self.patchWidth
                    for dy in 0..<Self.patch {
                        let row = ((y * Self.patch + dy) * frame.width + x * Self.patch) * 3
                        for k in 0..<(Self.patch * 3) {
                            px[out] = Float16(Float(bytes[row + k]) / 255)
                            out += 1
                        }
                    }
                }
            }
        }
        let geom = try geometry(across: across, down: down)
        return try MLDictionaryFeatureProvider(dictionary: [
            "patches": MLFeatureValue(multiArray: pixels), "positions": geom.positions,
            "position_embeddings": geom.embeddings, "valid": geom.valid,
            "pool": geom.pool,
        ])
    }

    private func zeroed(_ shape: [NSNumber]) throws -> MLMultiArray {
        let array = try MLMultiArray(shape: shape, dataType: .float16)
        memset(array.dataPointer, 0, array.count * MemoryLayout<Float16>.size)
        return array
    }
}
