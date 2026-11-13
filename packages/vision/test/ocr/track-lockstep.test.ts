// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FrameRate, ok, type NormalisedBox } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createOcrMeter } from '../../src/ocr/meter';
import { trackOnScreenText } from '../../src/ocr/track';
import { refineEdges, type OcrFrames } from '../../src/ocr/track-refine';
import type { OcrObservation, OcrPage } from '../../src/ocr/types';
import { observation } from './helpers/fakes';

const RATE = FrameRate.of(30);
const at = (y: number): NormalisedBox => ({ x: 0.1, y, width: 0.5, height: 0.05 });

/** Four texts, each shown on frames [from, to): the world the reader sees. */
const SHOWN = [
  { text: 'Alpha one', box: at(0.1), from: 25, to: 70 },
  { text: 'Bravo two', box: at(0.3), from: 41, to: 95 },
  { text: 'Charlie three', box: at(0.5), from: 20, to: 40 },
  { text: 'Delta four', box: at(0.7), from: 45, to: 46 },
];

function visible(frame: number): OcrObservation[] {
  return SHOWN.filter((s) => frame >= s.from && frame < s.to).map((s) => observation(s.text, s.box));
}

/** Samples a second (every 30 frames) of the world above. */
const SAMPLES: OcrPage[] = [0, 30, 60, 90, 120].map((frame) => ({ frame, observations: visible(frame) }));

function reader() {
  const batches: number[][] = [];
  const read: OcrFrames = async (frames) => {
    batches.push([...frames]);
    return ok(frames.map((frame) => ({ frame, observations: visible(frame) })));
  };
  const singles: number[] = [];
  const one = async (frame: number) => {
    singles.push(frame);
    return ok({ frame, observations: visible(frame) });
  };
  return { batches, read, singles, one };
}

describe('edge refinement in lockstep', () => {
  it('stores exactly what each track refined on its own stores, with fewer reads', async () => {
    const together = reader();
    const meter = createOcrMeter();
    const all = await trackOnScreenText(
      { rate: RATE, pages: SAMPLES, endFrame: 150, ocrFrames: together.read },
      { meter },
    );
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.value.map((t) => t.text)).toEqual(['Charlie three', 'Alpha one', 'Bravo two']);
    // Each text tracked alone, in a world with only that text: the edge-by-edge reads.
    let aloneReads = 0;
    for (const text of all.value) {
      const only = (page: OcrPage) => ({
        frame: page.frame,
        observations: page.observations.filter((o) => o.text === text.text),
      });
      const read: OcrFrames = async (frames) => {
        aloneReads += frames.length;
        return ok(frames.map((frame) => only({ frame, observations: visible(frame) })));
      };
      const alone = await trackOnScreenText({
        rate: RATE,
        pages: SAMPLES.map(only),
        endFrame: 150,
        ocrFrames: read,
      });
      expect(alone.ok && alone.value).toEqual([text]);
    }
    const reads = together.batches.flat().length;
    // Alpha and Charlie both start between samples 0 and 30: they share the read of frame 15.
    expect(together.batches[0]).toContain(15);
    expect(reads).toBeLessThan(aloneReads);
    expect(together.batches.length).toBeLessThanOrEqual(3);
    expect(meter.counts()).toMatchObject({ tracks: 3, flickers: 0, refineCalls: reads });
  });

  it('gives every edge the bisection it would get alone', async () => {
    // Charlie shows at 30 and not at 60 (an end edge); the bisection is the same with either edge's direction.
    const searches = SHOWN.slice(0, 3).map((s) => ({ absent: 30, present: 60, text: s.text, box: s.box }));
    const { read, batches } = reader();
    const together = await refineEdges(
      searches.map((s, i) => (i === 2 ? { ...s, absent: 60, present: 30 } : s)),
      read,
      undefined,
    );
    expect(together.ok).toBe(true);
    for (const [i, search] of searches.entries()) {
      const single = reader();
      const s = i === 2 ? { ...search, absent: 60, present: 30 } : search;
      const alone = await refineEdges([s], single.read, undefined);
      expect(together.ok && alone.ok && together.value[i]).toEqual(alone.ok && alone.value[0]);
    }
    // Round one reads frame 45 once for all three edges.
    expect(batches[0]).toEqual([45]);
  });

  it('drops a one-sample flicker after one shared read per round, and counts it', async () => {
    const ghost = (frame: number) => ({
      frame,
      observations: [0.1, 0.3, 0.5].map((y, i) => observation(`Ghost ${i}`, at(y))),
    });
    const pages = [{ frame: 0, observations: [] }, ghost(30), { frame: 60, observations: [] }];
    const { read, batches } = reader();
    const meter = createOcrMeter();
    const result = await trackOnScreenText({ rate: RATE, pages, ocrFrames: read }, { meter });
    expect(result.ok && result.value).toEqual([]);
    // Three ghosts, two edges each, three rounds: 2 distinct frames a round, not 6.
    expect(batches.map((b) => b.length)).toEqual([2, 2, 2]);
    expect(meter.counts()).toMatchObject({ tracks: 3, flickers: 3, refineCalls: 6 });
  });

  it("reads the last frame first: one read places an end at the clip's end", async () => {
    // A title shown to the end of a clip [0, 115), sampled at 0, 30, 60 and 90.
    const title = observation('Whole clip title', at(0.2));
    const shows = (frame: number) => frame < 115;
    const pages = [0, 30, 60, 90].map((frame) => ({ frame, observations: shows(frame) ? [title] : [] }));
    const batches: number[][] = [];
    const read: OcrFrames = async (frames) => {
      batches.push([...frames]);
      return ok(frames.map((frame) => ({ frame, observations: shows(frame) ? [title] : [] })));
    };
    const result = await trackOnScreenText({ rate: RATE, pages, endFrame: 115, ocrFrames: read });
    const range = result.ok ? result.value[0]?.range : undefined;
    expect([range?.start.value, range?.duration.value]).toEqual([0, 115]);
    expect(batches).toEqual([[114]]);
  });

  it('bisects as before when the text is gone at the end', async () => {
    // Shown [0, 100) in a clip [0, 115): the end probe (114) misses, three rounds bisect 90..114.
    const title = observation('Early end', at(0.2));
    const shows = (frame: number) => frame < 100;
    const pages = [0, 30, 60, 90].map((frame) => ({ frame, observations: shows(frame) ? [title] : [] }));
    const batches: number[][] = [];
    const read: OcrFrames = async (frames) => {
      batches.push([...frames]);
      return ok(frames.map((frame) => ({ frame, observations: shows(frame) ? [title] : [] })));
    };
    const meter = createOcrMeter();
    const result = await trackOnScreenText({ rate: RATE, pages, endFrame: 115, ocrFrames: read }, { meter });
    const range = result.ok ? result.value[0]?.range : undefined;
    const end = (range?.start.value ?? 0) + (range?.duration.value ?? 0);
    expect(range?.start.value).toBe(0);
    expect(end).toBeGreaterThanOrEqual(100);
    expect(end).toBeLessThanOrEqual(103);
    expect(batches[0]).toEqual([114]);
    expect(batches).toHaveLength(4);
    expect(meter.counts().refineCalls).toBe(4);
  });
});
