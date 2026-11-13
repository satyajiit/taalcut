// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

@preconcurrency import CoreML
import Foundation

/// EmbeddingGemma 2's text model on Core ML: one fixed-shape function per sequence length (`embed_32` …
/// `embed_512`, FluidInference's split), so each stays on the Neural Engine. Token rows come from the component's
/// q4 token table, already scaled by √512 (`EmbedTokenTable`; vision SPEC "Core ML backend"). Each function loads
/// when a text first needs it or `loadAll` runs (`EmbedTextFunctions`). Core ML predictions are thread-safe, so
/// frames can overlap (vision on the GPU, text on the Neural Engine).
@available(macOS 15, *)
final class EmbedTextModel: @unchecked Sendable {
    static let lengths = [32, 48, 64, 128, 256, 512]
    static let hiddenSize = 512
    static let dimension = 768
    static let bos: Int32 = 2
    static let eos: Int32 = 1
    static let pad: Int32 = 0
    static let imageStart: Int32 = 255_999
    static let imageEnd: Int32 = 258_882

    private let functions: EmbedTextFunctions
    private let table: any EmbedTokenTable

    private init(functions: EmbedTextFunctions, table: any EmbedTokenTable) {
        self.functions = functions
        self.table = table
    }

    /// The token table now; the functions as texts need them.
    static func load(files: EmbedModelFiles, units: MLComputeUnits) throws -> EmbedTextModel {
        EmbedTextModel(
            functions: EmbedTextFunctions(model: files.textModel, units: units),
            table: try loadTokenTable(files: files, columns: hiddenSize))
    }

    /// Every function, shortest first (queries and on-screen text use the short ones).
    func loadAll() async throws {
        for length in Self.lengths { _ = try await functions.model(length) }
    }

    /// One text's vector. The longest function holds 512 tokens: a longer text keeps its first 511 and its `<eos>`
    /// (the vision SPEC says what that means for parity).
    func embed(ids: [Int32]) async throws -> [Float] {
        let longest = Self.lengths.last ?? 512
        let kept = ids.count <= longest ? ids : Array(ids.prefix(longest - 1)) + [Self.eos]
        return try await run(count: kept.count) { target, length in
            writeRows(kept + [Int32](repeating: Self.pad, count: length - kept.count), to: target, at: 0)
        }
    }

    /// A frame's vector: `<bos> <|image> tokens <image|> <eos>`, the tokens being the first `count` rows of the
    /// vision function's `image_tokens`.
    func embed(imageTokens tokens: MLMultiArray, count: Int) async throws -> [Float] {
        let stride = tokens.strides[tokens.strides.count - 2].intValue
        return try await run(count: count + 4) { target, length in
            writeRows([Self.bos, Self.imageStart], to: target, at: 0)
            copyTokens(tokens, stride: stride, count: count, to: target + 2 * Self.hiddenSize)
            let tail = [Self.imageEnd, Self.eos] + [Int32](repeating: Self.pad, count: length - count - 4)
            writeRows(tail, to: target, at: 2 + count)
        }
    }

    /// The smallest `embed_S` that holds `count` rows; `fill` writes all S rows of fp16 input.
    private func run(
        count: Int, fill: (UnsafeMutablePointer<Float16>, Int) -> Void
    ) async throws -> [Float] {
        guard let length = Self.lengths.first(where: { $0 >= count }) else { throw EmbedError.tooLong(count) }
        let model = try await functions.model(length)
        let embeds = try MLMultiArray(shape: [1, NSNumber(value: length), NSNumber(value: Self.hiddenSize)], dataType: .float16)
        let mask = try MLMultiArray(shape: [1, NSNumber(value: length)], dataType: .float16)
        fill(embeds.dataPointer.assumingMemoryBound(to: Float16.self), length)
        let maskPointer = mask.dataPointer.assumingMemoryBound(to: Float16.self)
        for position in 0..<length { maskPointer[position] = position < count ? 1 : 0 }
        let input = try MLDictionaryFeatureProvider(dictionary: [
            "inputs_embeds": MLFeatureValue(multiArray: embeds), "attention_mask": MLFeatureValue(multiArray: mask),
        ])
        let output = try await model.prediction(from: input)
        guard let vector = output.featureValue(for: "embedding")?.multiArrayValue, vector.count == Self.dimension else {
            throw EmbedError.badOutput("embedding")
        }
        return floats(vector, count: Self.dimension)
    }

    private func writeRows(_ ids: [Int32], to target: UnsafeMutablePointer<Float16>, at row: Int) {
        for (offset, id) in ids.enumerated() {
            table.write(row: min(max(Int(id), 0), table.rows - 1), to: target + (row + offset) * Self.hiddenSize)
        }
    }

    private func copyTokens(
        _ tokens: MLMultiArray, stride: Int, count: Int, to target: UnsafeMutablePointer<Float16>
    ) {
        for row in 0..<count {
            for column in 0..<Self.hiddenSize {
                let index = row * stride + column
                target[row * Self.hiddenSize + column] =
                    tokens.dataType == .float16
                    ? tokens.dataPointer.assumingMemoryBound(to: Float16.self)[index]
                    : Float16(tokens.dataPointer.assumingMemoryBound(to: Float.self)[index])
            }
        }
    }
}

/// The text model's functions by length, each loaded once however many requests ask for it; a failed load is tried
/// again by the next request. After the helper's idle exit a query waits for `embed_32` alone, not all six (IX3-N4).
@available(macOS 15, *)
actor EmbedTextFunctions {
    private let url: URL
    private let units: MLComputeUnits
    private var loads: [Int: Task<MLModel, Error>] = [:]

    init(model url: URL, units: MLComputeUnits) {
        self.url = url
        self.units = units
    }

    func model(_ length: Int) async throws -> MLModel {
        let task = loads[length] ?? Task { [url, units] in try await loadFunction(url, name: "embed_\(length)", units: units) }
        loads[length] = task
        do {
            return try await task.value
        } catch {
            if loads[length] == task { loads[length] = nil }
            throw error
        }
    }
}

@available(macOS 15, *)
func loadFunction(_ url: URL, name: String, units: MLComputeUnits) async throws -> MLModel {
    let configuration = MLModelConfiguration()
    configuration.computeUnits = units
    configuration.functionName = name
    return try await MLModel.load(contentsOf: url, configuration: configuration)
}

/// The first `count` values of an fp16 or fp32 array, as Float.
func floats(_ array: MLMultiArray, count: Int) -> [Float] {
    if array.dataType == .float16 {
        let pointer = array.dataPointer.assumingMemoryBound(to: Float16.self)
        return (0..<count).map { Float(pointer[$0]) }
    }
    let pointer = array.dataPointer.assumingMemoryBound(to: Float.self)
    return Array(UnsafeBufferPointer(start: pointer, count: count))
}
