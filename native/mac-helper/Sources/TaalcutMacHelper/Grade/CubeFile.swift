// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

enum CubeParseError: Error, Equatable, Sendable {
    case invalid
}

struct CubeLUT: Sendable, Equatable {
    static let dimension = 17
    var samples: [Float]

    var count: Int { samples.count / 4 }
}

func parseCube(_ text: String) -> Result<CubeLUT, CubeParseError> {
    if text.contains("\r") { return .failure(.invalid) }
    var dimension: Int?
    var rows: [Float] = []
    for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = raw.trimmingCharacters(in: .whitespaces)
        if line.isEmpty || line.hasPrefix("#") { continue }
        let parts = line.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard let head = parts.first else { continue }
        if head == "TITLE" { continue }
        if head == "LUT_1D_SIZE" { return .failure(.invalid) }
        if head == "LUT_3D_SIZE" {
            guard parts.count == 2, let size = Int(parts[1]), dimension == nil else { return .failure(.invalid) }
            if size != CubeLUT.dimension { return .failure(.invalid) }
            dimension = size
            continue
        }
        if head == "DOMAIN_MIN" {
            guard domain(parts, expected: 0) else { return .failure(.invalid) }
            continue
        }
        if head == "DOMAIN_MAX" {
            guard domain(parts, expected: 1) else { return .failure(.invalid) }
            continue
        }
        guard parts.count == 3, let red = Float(parts[0]), let green = Float(parts[1]), let blue = Float(parts[2]) else {
            return .failure(.invalid)
        }
        if !(0...1).contains(red) || !(0...1).contains(green) || !(0...1).contains(blue) {
            return .failure(.invalid)
        }
        rows.append(contentsOf: [red, green, blue, 1])
    }
    let expected = CubeLUT.dimension * CubeLUT.dimension * CubeLUT.dimension
    guard dimension == CubeLUT.dimension, rows.count == expected * 4 else { return .failure(.invalid) }
    return .success(CubeLUT(samples: rows))
}

func cubeData(_ lut: CubeLUT) -> Data {
    var samples = lut.samples
    return Data(bytes: &samples, count: samples.count * MemoryLayout<Float>.size)
}

private func domain(_ parts: [String], expected: Float) -> Bool {
    guard parts.count == 4 else { return false }
    for part in parts.dropFirst() {
        guard let value = Float(part), value == expected else { return false }
    }
    return true
}
