// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-F4: the windows each model reads, against the spans upstream used on every parity clip. */
import { describe, expect, it } from 'vitest';
import { intermediate, loadClip, manifest } from '../../../../tools/earshot-parity/fixtures.mjs';
import { resample48kTo16k } from '../../src/listen/models/resample';
import {
  astWindows,
  clapInputWindows,
  clapSpans,
  pyRound,
  windowStarts,
} from '../../src/listen/models/windows';

describe('listen windows', () => {
  it("Python's round: halves to even", () => {
    expect([0.5, 1.5, 2.5, 3.5, 2.4999, 2.5001].map(pyRound)).toEqual([0, 2, 2, 4, 2, 3]);
  });

  it('spans_for on every parity clip: the same spans to the microsecond', () => {
    const rows = intermediate<Record<string, { duration: number; spans: [number, number][] }>>('clap-audio');
    for (const clip of manifest().clips) {
      const row = rows[clip.id];
      expect(row, clip.id).toBeDefined();
      if (!row) continue;
      const loaded = loadClip(clip.id);
      const duration = (loaded.channels[0]?.length ?? 0) / loaded.sampleRate;
      const spans = clapSpans(0, Math.max(duration, 0.01));
      expect(spans.length, clip.id).toBe(row.spans.length);
      spans.forEach((span, i) => {
        expect(span[0]).toBeCloseTo(row.spans[i]?.[0] ?? -1, 6);
        expect(span[1]).toBeCloseTo(row.spans[i]?.[1] ?? -1, 6);
      });
    }
  });

  it('at most 6 windows, evenly spaced, the last flush with the end', () => {
    const spans = clapSpans(0, 70);
    expect(spans.map((span) => span[0])).toEqual([0, 10, 25, 35, 50, 60]);
    expect(clapSpans(2, 9)).toEqual([[2, 9]]);
  });

  it("AST's windows: 10.24 s, hop 5.12 s, the last flush, as upstream cut them", () => {
    const ast = intermediate<{ clips: Record<string, { windowStarts16k: number[] }> }>('ast');
    for (const [id, row] of Object.entries(ast.clips)) {
      const loaded = loadClip(id);
      const length = Math.round((loaded.channels[0]?.length ?? 0) / 3);
      expect(windowStarts(length, 163_840, 81_920), id).toEqual(row.windowStarts16k);
    }
    expect(astWindows(resample48kTo16k(new Float32Array(48_000)))).toHaveLength(1);
  });

  it('a CLAP input over 10 s is split like Clap.embed_audio', () => {
    expect(clapInputWindows(new Float32Array(480_000))).toHaveLength(1);
    expect(clapInputWindows(new Float32Array(480_001)).map((w) => w.length)).toEqual([480_000, 480_000]);
    expect(windowStarts(1_200_000, 480_000, 240_000)).toEqual([0, 240_000, 480_000, 720_000]);
  });
});
