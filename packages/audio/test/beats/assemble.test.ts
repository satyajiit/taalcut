// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** BRK1-ACC: a beat map's tempo from its span and its downbeats on whole bars, with no model file. */
import { describe, expect, it } from 'vitest';
import { assembleBeatAnalysis } from '../../src/beats/assemble';

const FPS = 50;
/** Beat frames (at 50 per second) of a steady tempo, as the tracker's peaks land: on its 20 ms grid. */
function steady(bpm: number, count: number, firstMs: number): number[] {
  const periodMs = 60_000 / bpm;
  return Array.from({ length: count }, (_, i) => Math.round(((firstMs + i * periodMs) * FPS) / 1000));
}

const onset = (frames: number) => new Float32Array(frames);

describe('assembleBeatAnalysis: bpm', () => {
  it('measures the tempo over the whole map, not from the median of 20 ms-rounded intervals', () => {
    // 97.3 BPM is a 616.6 ms beat: rounded to the grid, most intervals read 620 ms (96.8 BPM).
    const beats = steady(97.3, 23, 310);
    const { beatMap } = assembleBeatAnalysis({
      beatFrames: beats,
      downbeatFrames: [],
      onset: onset(700),
      shiftMs: 0,
    });
    expect(beatMap.bpm).not.toBeNull();
    expect(Math.abs(beatMap.bpm! - 97.3) / 97.3).toBeLessThanOrEqual(0.002);
  });

  it('keeps the tempo when the tracker skips a beat', () => {
    const beats = steady(120, 30, 500).filter((_, i) => i !== 12);
    const { beatMap } = assembleBeatAnalysis({
      beatFrames: beats,
      downbeatFrames: [],
      onset: onset(900),
      shiftMs: 0,
    });
    expect(Math.abs(beatMap.bpm! - 120) / 120).toBeLessThanOrEqual(0.002);
  });

  it('still has no tempo for rubato', () => {
    const beats = [10, 40, 55, 100, 112, 160];
    const { beatMap } = assembleBeatAnalysis({
      beatFrames: beats,
      downbeatFrames: [],
      onset: onset(200),
      shiftMs: 0,
    });
    expect(beatMap.bpm).toBeNull();
  });
});

describe('assembleBeatAnalysis: downbeats', () => {
  it("puts the downbeats on whole bars, at the phase most of the model's downbeats agree on", () => {
    const beats = steady(97.3, 22, 760);
    // The model's downbeats: bars at beats 1, 5, 9, 13, 17 and three strays at 7, 11 and 19.
    const downbeats = [1, 5, 7, 9, 11, 13, 17, 19].map((index) => beats[index]!);
    const { beatMap } = assembleBeatAnalysis({
      beatFrames: beats,
      downbeatFrames: downbeats,
      onset: onset(700),
      shiftMs: 0,
    });
    expect(beatMap.downbeats).toEqual([1, 5, 9, 13, 17, 21]);
    expect(beatMap.beatsPerBar).toBe(4);
  });

  it('finds three-beat bars when the model hears them', () => {
    const beats = steady(90, 24, 300);
    const downbeats = [1, 4, 7, 10, 13, 16, 19, 22].map((index) => beats[index]!);
    const { beatMap } = assembleBeatAnalysis({
      beatFrames: beats,
      downbeatFrames: downbeats,
      onset: onset(1000),
      shiftMs: 0,
    });
    expect(beatMap.downbeats).toEqual([1, 4, 7, 10, 13, 16, 19, 22]);
    expect(beatMap.beatsPerBar).toBe(3);
  });

  it('leaves regular model downbeats as they are', () => {
    const beats = steady(128, 32, 100);
    const downbeats = [0, 4, 8, 12, 16, 20, 24, 28].map((index) => beats[index]!);
    const { beatMap } = assembleBeatAnalysis({
      beatFrames: beats,
      downbeatFrames: downbeats,
      onset: onset(800),
      shiftMs: 0,
    });
    expect(beatMap.downbeats).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(beatMap.beatsPerBar).toBe(4);
  });
});
