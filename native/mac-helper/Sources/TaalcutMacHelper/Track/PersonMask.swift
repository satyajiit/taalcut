// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreVideo
import Foundation
import Vision

/// FRM1: Vision's person instance mask (`VNGeneratePersonInstanceMaskRequest`, up to four people), row 0 at the top.
/// Each pixel holds its person's index (0 is nobody). Used only to find whole heads and the coarse silhouette; it is
/// never sent anywhere.
struct PersonMask: Sendable {
    var width: Int
    var height: Int
    var labels: [UInt8]
    var instances: [Int]

    func label(_ x: Int, _ y: Int) -> UInt8 { labels[y * width + x] }
}

/// The span of one person's pixels on each row (top-left space), and their bounding box.
struct PersonRows: Sendable {
    var index: Int
    /// Per row: (min x, max x, count), or nil when the row has none of this person.
    var rows: [(minX: Int, maxX: Int, count: Int)?]
    var top: Int
    var bottom: Int
    var minX: Int
    var maxX: Int
    var pixels: Int
}

func personMask(
    _ buffer: CVPixelBuffer, report: inout ComputeReport, logged: inout Set<String>, log: LineLog
) throws -> PersonMask? {
    let request = VNGeneratePersonInstanceMaskRequest()
    report.silhouette = assignVisionCompute(request, which: "silhouette", logged: &logged, log: log)
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, options: [:])
    try handler.perform([request])
    guard let observation = request.results?.first else { return nil }
    let instances = observation.allInstances.map { $0 }
    let mask = observation.instanceMask
    CVPixelBufferLockBaseAddress(mask, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(mask) else { return nil }
    let width = CVPixelBufferGetWidth(mask)
    let height = CVPixelBufferGetHeight(mask)
    let stride = CVPixelBufferGetBytesPerRow(mask)
    var labels = [UInt8](repeating: 0, count: width * height)
    let bytes = base.assumingMemoryBound(to: UInt8.self)
    for row in 0..<height {
        for col in 0..<width { labels[row * width + col] = bytes[row * stride + col] }
    }
    return PersonMask(width: width, height: height, labels: labels, instances: instances)
}

/// Each person's largest connected patch of pixels, row by row. Vision's instance mask strays onto railings and
/// furniture beside people; the patch that holds the body is the biggest one.
func personRows(_ mask: PersonMask) -> [PersonRows] {
    let width = mask.width
    let height = mask.height
    let count = width * height
    var component = [Int32](repeating: -1, count: count)
    var best: [UInt8: (id: Int32, size: Int)] = [:]
    var queue = [Int]()
    queue.reserveCapacity(count)
    var next: Int32 = 0
    for start in 0..<count where mask.labels[start] != 0 && component[start] < 0 {
        let label = mask.labels[start]
        component[start] = next
        queue.removeAll(keepingCapacity: true)
        queue.append(start)
        var head = 0
        while head < queue.count {
            let at = queue[head]
            head += 1
            let x = at % width
            let y = at / width
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let nx = x + dx
                let ny = y + dy
                guard nx >= 0, nx < width, ny >= 0, ny < height else { continue }
                let near = ny * width + nx
                if component[near] < 0, mask.labels[near] == label {
                    component[near] = next
                    queue.append(near)
                }
            }
        }
        if queue.count > (best[label]?.size ?? 0) { best[label] = (next, queue.count) }
        next += 1
    }
    var people: [PersonRows] = []
    for (label, kept) in best.sorted(by: { $0.key < $1.key }) {
        var rows: [(minX: Int, maxX: Int, count: Int)?] = Array(repeating: nil, count: height)
        var top = height
        var bottom = -1
        var minX = width
        var maxX = -1
        for y in 0..<height {
            var lo = Int.max
            var hi = -1
            var n = 0
            let base = y * width
            for x in 0..<width where component[base + x] == kept.id {
                lo = min(lo, x)
                hi = max(hi, x)
                n += 1
            }
            guard n > 0 else { continue }
            rows[y] = (lo, hi, n)
            top = min(top, y)
            bottom = max(bottom, y)
            minX = min(minX, lo)
            maxX = max(maxX, hi)
        }
        people.append(PersonRows(
            index: Int(label), rows: rows, top: top, bottom: bottom, minX: minX, maxX: maxX, pixels: kept.size))
    }
    return people
}

/// The silhouette: `cols` × `rows` cells over the frame, a cell set when people cover at least a quarter of it.
/// Bits row-major from the top left, most significant bit first, base64 (core's `silhouetteSchema`).
func silhouetteGrid(_ mask: PersonMask, cols: Int = 32, rows: Int = 32) -> SilhouetteGrid {
    var bytes = [UInt8](repeating: 0, count: (cols * rows + 7) / 8)
    for row in 0..<rows {
        let y0 = row * mask.height / rows
        let y1 = max(y0 + 1, (row + 1) * mask.height / rows)
        for col in 0..<cols {
            let x0 = col * mask.width / cols
            let x1 = max(x0 + 1, (col + 1) * mask.width / cols)
            var covered = 0
            for y in y0..<min(y1, mask.height) {
                for x in x0..<min(x1, mask.width) where mask.label(x, y) != 0 { covered += 1 }
            }
            let total = (y1 - y0) * (x1 - x0)
            if total > 0, covered * 4 >= total {
                let bit = row * cols + col
                bytes[bit >> 3] |= UInt8(0x80 >> (bit & 7))
            }
        }
    }
    return SilhouetteGrid(cols: cols, rows: rows, bits: Data(bytes).base64EncodedString())
}

struct SilhouetteGrid: Sendable, Equatable {
    var cols: Int
    var rows: Int
    var bits: String
}

/// The Neural Engine when Vision lists it for the request's main stage; a CPU-only request is logged once.
func assignVisionCompute(
    _ request: VNRequest, which: String, logged: inout Set<String>, log: LineLog
) -> ComputeKind {
    let devices = (try? request.supportedComputeStageDevices[.main]) ?? []
    let kinds = devices.map { device -> ComputeKind in
        switch device {
        case .cpu: return .cpu
        case .neuralEngine: return .neuralEngine
        case .gpu: return .gpu
        @unknown default: return .gpu
        }
    }
    let chosen = chooseCompute(available: kinds)
    if chosen == .neuralEngine, let device = devices.first(where: {
        if case .neuralEngine = $0 { return true }
        return false
    }) {
        request.setComputeDevice(device, for: .main)
    }
    if chosen == .cpu {
        noteCPUFallback(which: which, reason: "only the CPU is listed for the main stage", logged: &logged, log: log)
    }
    return chosen
}
