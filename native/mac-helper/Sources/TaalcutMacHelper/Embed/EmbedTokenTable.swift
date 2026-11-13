// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// The text model's token table: row `id` is token `id`'s input embedding (`columns` fp16 values, Gemma's √512
/// scale included). Read one row at a time into a request's input.
protocol EmbedTokenTable: Sendable {
    var rows: Int { get }
    /// Writes row `row`'s values to `target`.
    func write(row: Int, to target: UnsafeMutablePointer<Float16>)
}

/// The component's table: `embeddings.q4` (IX3-N1), or `embeddings.f16` from a component packed before it.
func loadTokenTable(files: EmbedModelFiles, columns: Int) throws -> any EmbedTokenTable {
    if FileManager.default.fileExists(atPath: files.tokenTableQ4.path) {
        return try Q4TokenTable(data: Data(contentsOf: files.tokenTableQ4, options: .alwaysMapped), columns: columns)
    }
    return try Fp16TokenTable(data: Data(contentsOf: files.tokenTable, options: .alwaysMapped), columns: columns)
}

/// `embeddings.f16`: the dequantised table, `rows × columns` fp16 (256 MiB).
struct Fp16TokenTable: EmbedTokenTable {
    let rows: Int
    private let data: Data
    private let columns: Int

    init(data: Data, columns: Int) throws {
        guard data.count > 0, data.count % (columns * 2) == 0 else {
            throw EmbedError.invalidModel("embeddings.f16 is not a table of \(columns)-wide fp16 rows")
        }
        self.data = data
        self.columns = columns
        rows = data.count / (columns * 2)
    }

    func write(row: Int, to target: UnsafeMutablePointer<Float16>) {
        data.withUnsafeBytes { raw in
            let source = raw.bindMemory(to: Float16.self)
            for column in 0..<columns { target[column] = source[row * columns + column] }
        }
    }
}

/// `embeddings.q4` (tools/components/embeddinggemma-coreml/token_table.py): the ONNX component's own 4-bit table
/// (82 MiB). A 16-byte header (`TQ4T`, version 1, rows, columns; little endian), then the codes (two a byte, the even
/// column in the low nibble), a float32 scale per block of 32 columns, and the zero points (two a byte, the even block
/// in the low nibble). A value is `Float16(scale × (code − zero point))`, the product in Float: the bytes
/// `embeddings.f16` holds for it.
struct Q4TokenTable: EmbedTokenTable {
    static let magic: [UInt8] = Array("TQ4T".utf8)
    static let block = 32
    let rows: Int
    private let data: Data
    private let columns: Int
    private let scalesAt: Int
    private let zerosAt: Int

    init(data: Data, columns: Int) throws {
        let invalid = EmbedError.invalidModel("embeddings.q4 is not a 4-bit table of \(columns)-wide rows")
        guard data.count >= 16, Array(data.prefix(4)) == Self.magic, Self.word(data, 4) == 1,
            Self.word(data, 12) == columns, columns % (2 * Self.block) == 0
        else { throw invalid }
        let rows = Self.word(data, 8)
        let blocks = columns / Self.block
        let codes = rows * columns / 2
        guard rows > 0, data.count == 16 + codes + rows * blocks * 4 + rows * blocks / 2 else { throw invalid }
        self.data = data
        self.columns = columns
        self.rows = rows
        scalesAt = 16 + codes
        zerosAt = scalesAt + rows * blocks * 4
    }

    private static func word(_ data: Data, _ offset: Int) -> Int {
        data.withUnsafeBytes { Int(UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self))) }
    }

    func write(row: Int, to target: UnsafeMutablePointer<Float16>) {
        let blocks = columns / Self.block
        data.withUnsafeBytes { raw in
            for block in 0..<blocks {
                let scaleBits = raw.loadUnaligned(fromByteOffset: scalesAt + (row * blocks + block) * 4, as: UInt32.self)
                let scale = Float(bitPattern: UInt32(littleEndian: scaleBits))
                let zeros = raw[zerosAt + (row * blocks + block) / 2]
                let zero = Int(block % 2 == 0 ? zeros & 0x0F : zeros >> 4)
                for offset in 0..<Self.block {
                    let column = block * Self.block + offset
                    let codes = raw[16 + (row * columns + column) / 2]
                    let code = Int(column % 2 == 0 ? codes & 0x0F : codes >> 4)
                    target[column] = Float16(scale * Float(code - zero))
                }
            }
        }
    }
}
