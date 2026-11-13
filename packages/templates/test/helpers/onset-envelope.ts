// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An onset envelope shaped like the beat tracker's (audio's beats/graph.ts): spectral flux at 50 frames a second,
 * the sum of the rises over the mel bands, so values run into the tens. Here 8 s at 120 BPM: a busy floor of 4 to
 * 12, beats near 40, downbeats near 80, a quiet bridge from 4 s to 5.2 s, and 0 at the first frame (no frame
 * before it to rise from). Deterministic.
 */
export const ENVELOPE_RATE = 50;
export const QUIET = { from: 200, to: 260 } as const;

export function onsetEnvelope(frames = 400): number[] {
  return Array.from({ length: frames }, (_, frame) => {
    if (frame === 0) return 0;
    const floor = 8 + 4 * Math.sin(frame * 0.37) * Math.cos(frame * 0.11);
    if (frame >= QUIET.from && frame < QUIET.to) return 0.5 + Math.abs(Math.sin(frame * 0.53)) * 2;
    if (frame % 100 === 0) return 80 + (frame % 7);
    if (frame % 25 === 0) return 38 + (frame % 5);
    return floor;
  });
}
