// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Ducking and the voice-over-music check (SPEC P3.5). Margins, floor, attack and release are the timeline's. */
export const MIX_CONFIG = {
  sampleRate: 48_000,
  /** ebur128's metadata frames. */
  hopMs: 100,
  voice: {
    /** A 400 ms window louder than this, and within `belowPeakLu` of the stem's loudest, has voice in it. */
    floorLufs: -55,
    belowPeakLu: 25,
    padBeforeMs: 120,
    padAfterMs: 80,
    mergeGapMs: 300,
  },
  envelope: {
    /** The plan aims this far past the margin, so the 3 s check still passes after the ramps. */
    headroomLu: 1,
    holdMs: 150,
    /** Envelope maths step; points are kept only where the slope changes. */
    stepMs: 10,
    /** Momentary loudness of silence, as FFmpeg reports it. */
    silenceLufs: -120,
  },
  check: {
    /** Short-term loudness covers 3 s; a frame counts when voice fills at least this much of it. */
    windowMs: 3000,
    minVoicedMs: 1500,
    worst: 5,
  },
} as const;
