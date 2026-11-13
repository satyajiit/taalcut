// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import CoreMedia

/// Places decoded frames on the analysis grid the way FFmpeg's `setpts=PTS-STARTPTS,fps=R:round=near` does for a
/// constant-rate source whose frames already sit on the grid: frame n is the one at `origin + n / R`. Anything that
/// would make FFmpeg drop or repeat a frame (a gap, a repeat, a frame far from its slot) is `offGrid`, and the caller
/// gives the file back to FFmpeg rather than guess.
struct GridIndexer {
    enum Placement: Equatable {
        /// Before the window (a segment's pre-roll): decoded, not kept.
        case before
        case frame(Int)
        /// Past the window: stop.
        case after
        case offGrid(found: Int, expected: Int)
    }

    /// A frame further than this from its slot (in frames) is off the grid.
    static let slotTolerance = 0.25

    private let origin: CMTime
    private let rate: GridRate
    private let first: Int
    private let end: Int
    private var expected: Int

    init(origin: CMTime, rate: GridRate, window: PassWindow?) {
        self.origin = origin
        self.rate = rate
        first = window?.from ?? 0
        end = window.map { $0.from + $0.frames } ?? Int.max
        expected = first
    }

    /// The next grid frame the caller should see.
    var nextIndex: Int { expected }

    /// Grid frames placed so far.
    var placed: Int { expected - first }

    mutating func place(_ time: CMTime) -> Placement {
        let exact = CMTimeSubtract(time, origin).seconds * rate.framesPerSecond
        guard exact.isFinite else { return .offGrid(found: -1, expected: expected) }
        let slot = Int(exact.rounded())
        if abs(exact - Double(slot)) > Self.slotTolerance { return .offGrid(found: slot, expected: expected) }
        if slot >= end { return .after }
        if slot < expected {
            // Before the window's first frame is pre-roll; going back once inside it is a repeat on the grid.
            return expected == first ? .before : .offGrid(found: slot, expected: expected)
        }
        if slot > expected { return .offGrid(found: slot, expected: expected) }
        expected += 1
        return .frame(slot)
    }
}
