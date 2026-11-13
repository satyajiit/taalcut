// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

/// A small table in `embeddings.q4`'s layout from its logical codes, zero points and scales, packed here byte by
/// byte as tools/components/embeddinggemma-coreml/token_table.py packs the real one.
private struct LogicalTable {
    let rows: Int
    let columns: Int
    var blocks: Int { columns / 32 }
    func code(_ row: Int, _ column: Int) -> Int { (column * 7 + row * 3) % 16 }
    func zero(_ row: Int, _ block: Int) -> Int { (block * 5 + row) % 16 }
    func scale(_ row: Int, _ block: Int) -> Float { Float(1 + row + block) * 0.0137 }
    func value(_ row: Int, _ column: Int) -> Float16 {
        Float16(scale(row, column / 32) * Float(code(row, column) - zero(row, column / 32)))
    }

    func q4(version: UInt32 = 1, columnsInHeader: Int? = nil) -> Data {
        var data = Data("TQ4T".utf8)
        for word in [version, UInt32(rows), UInt32(columnsInHeader ?? columns)] {
            withUnsafeBytes(of: word.littleEndian) { data.append(contentsOf: $0) }
        }
        for row in 0..<rows {
            for pair in stride(from: 0, to: columns, by: 2) {
                data.append(UInt8(code(row, pair) | code(row, pair + 1) << 4))
            }
        }
        for row in 0..<rows {
            for block in 0..<blocks {
                withUnsafeBytes(of: scale(row, block).bitPattern.littleEndian) { data.append(contentsOf: $0) }
            }
        }
        for row in 0..<rows {
            for pair in stride(from: 0, to: blocks, by: 2) { data.append(UInt8(zero(row, pair) | zero(row, pair + 1) << 4)) }
        }
        return data
    }

    func f16() -> Data {
        var data = Data()
        for row in 0..<rows {
            for column in 0..<columns { withUnsafeBytes(of: value(row, column).bitPattern.littleEndian) { data.append(contentsOf: $0) } }
        }
        return data
    }
}

private func rowOf(_ table: any EmbedTokenTable, _ row: Int, columns: Int) -> [Float16] {
    var out = [Float16](repeating: 0, count: columns)
    out.withUnsafeMutableBufferPointer { buffer in
        if let base = buffer.baseAddress { table.write(row: row, to: base) }
    }
    return out
}

@Suite struct EmbedTokenTableTests {
    @Test func q4RowsDequantiseEachCodeWithItsBlocksScaleAndZeroPoint() throws {
        let logical = LogicalTable(rows: 3, columns: 128)
        let table = try Q4TokenTable(data: logical.q4(), columns: 128)
        #expect(table.rows == 3)
        for row in 0..<3 {
            #expect(rowOf(table, row, columns: 128) == (0..<128).map { logical.value(row, $0) })
        }
    }

    @Test func q4AndF16TablesOfTheSameValuesGiveTheSameRows() throws {
        let logical = LogicalTable(rows: 4, columns: 64)
        let q4 = try Q4TokenTable(data: logical.q4(), columns: 64)
        let f16 = try Fp16TokenTable(data: logical.f16(), columns: 64)
        for row in 0..<4 { #expect(rowOf(q4, row, columns: 64) == rowOf(f16, row, columns: 64)) }
    }

    @Test func aQ4FileWithTheWrongHeaderOrLengthIsRefused() {
        let logical = LogicalTable(rows: 2, columns: 64)
        #expect(throws: EmbedError.self) { try Q4TokenTable(data: logical.q4(version: 2), columns: 64) }
        #expect(throws: EmbedError.self) { try Q4TokenTable(data: logical.q4(columnsInHeader: 128), columns: 64) }
        #expect(throws: EmbedError.self) { try Q4TokenTable(data: logical.q4().dropLast(), columns: 64) }
        #expect(throws: EmbedError.self) { try Q4TokenTable(data: Data("TQ4X".utf8) + logical.q4().dropFirst(4), columns: 64) }
        #expect(throws: EmbedError.self) { try Q4TokenTable(data: Data(), columns: 64) }
        #expect(throws: EmbedError.self) { try Fp16TokenTable(data: Data(count: 63), columns: 64) }
    }

    @Test func theComponentsQ4TableComesFirstAndF16StillLoads() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-table-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let files = EmbedModelFiles(directory: root)
        #expect(files.missing.contains("embeddings.q4"))
        let logical = LogicalTable(rows: 2, columns: 64)
        try logical.f16().write(to: files.tokenTable)
        #expect(!files.missing.contains("embeddings.q4") && !files.missing.contains("embeddings.f16"))
        #expect(try loadTokenTable(files: files, columns: 64) is Fp16TokenTable)
        try logical.q4().write(to: files.tokenTableQ4)
        #expect(try loadTokenTable(files: files, columns: 64) is Q4TokenTable)
    }
}
