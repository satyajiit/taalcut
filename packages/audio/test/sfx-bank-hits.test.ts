// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-D2 through the sound-effect service: a version 1 `addHits` (no bank sounds asked for) plans from the v1 pack
 * exactly as before (the expected hits below were also checked against the planner as it was before EAR1-D2,
 * hit-plan.ts at 387e1ab07); asked-for bank sounds land their apex on the cut, name their bank sound, and reach the library as
 * bundled `sfx-bank` items under their own licence; a sound that isn't in the bank or was withheld is refused.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FrameRate,
  newId,
  ok,
  RationalTime,
  type SequenceItem,
  type SfxHit,
  type Timeline,
} from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TransitionKind } from '../src/sfx/cuts';
import { createSfxService } from '../src/sfx/hits-service';
import type { SfxPackItem } from '../src/sfx/pack-catalogue';
import { memorySink } from './helpers/sinks';
import { makeTestTimeline, steadyBeatMap } from './helpers/timeline';
import { bankCatalogue, bankItem, bankTake, fitItem, writeCatalogue } from './sfx-bank-helpers';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-sfx-bank-hits-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const packItem = (id: string, category: SfxPackItem['category'], durationMs: number, peakMs: number) => ({
  id,
  title: id,
  category,
  file: `${id}.flac`,
  durationMs,
  peakMs,
  loudnessLufs: -16,
  licence: 'CC0-1.0' as const,
  source: 'https://example.org/cc0',
});
const PACK = [
  packItem('whoosh-a', 'whoosh', 800, 420),
  packItem('whoosh-b', 'whoosh', 700, 350),
  packItem('riser-a', 'riser', 1500, 1499),
  packItem('impact-a', 'impact', 900, 15),
  packItem('hit-a', 'hit', 300, 5),
];

/** Clips of `frames` at 30 fps on a 120 BPM grid, with transitions between (hit-plan.test.ts's). */
function timeline(frames: readonly number[], transitions: readonly (TransitionKind | null)[]): Timeline {
  const tl = makeTestTimeline({
    rate: FrameRate.of(30),
    clips: frames.map((f) => ({ frames: f })),
    beatMap: steadyBeatMap(120, 30),
  });
  const video = tl.tracks[0];
  if (!video || video.kind !== 'video') throw new Error('no V1');
  const items: SequenceItem[] = [];
  video.items.forEach((clip, i) => {
    const kind = transitions[i - 1];
    if (i > 0 && kind)
      items.push({
        type: 'transition',
        id: newId<'TimelineItem'>(),
        kind,
        inOffset: RationalTime.of(5, tl.canvas.rate),
        outOffset: RationalTime.of(5, tl.canvas.rate),
        direction: null,
      });
    items.push(clip.type === 'clip' ? { ...clip, sourceStart: RationalTime.of(10, tl.canvas.rate) } : clip);
  });
  return { ...tl, tracks: [{ ...video, items }] };
}

function service(bankDir: string | null) {
  const sink = memorySink();
  const sfx = createSfxService({
    pack: { load: async () => ok({ items: PACK, pathOf: (item) => join(dir, item.file) }) },
    bankDir: () => bankDir,
    sink,
    provider: { generate: async () => Promise.reject(new Error('unused')) } as never,
    media: { binaries: {} } as never,
    meter: { measure: async () => Promise.reject(new Error('unused')) } as never,
    clock: { now: () => 0 } as never,
  });
  return { sfx, sink };
}

/** A hit without its fresh ids, as plain numbers. */
const shape = (hit: SfxHit) => ({
  at: RationalTime.toSeconds(hit.at) * 1000,
  cut: hit.cut ? RationalTime.toSeconds(hit.cut) * 1000 : null,
  sourceStart: RationalTime.toSeconds(hit.sourceStart) * 1000,
  duration: RationalTime.toSeconds(hit.duration) * 1000,
  gainDb: hit.gainDb,
  category: hit.category,
  keys: Object.keys(hit).sort().join(','),
});

describe('addHits version 1 (EAR1-D2: unchanged)', () => {
  // EAR1-R2: where two sounds overlap, the first keeps its peak and 50 ms (the whoosh's 420 → 470 ms) and the riser
  // starts 50 ms into itself, its end still on its cut; EAR1-K3: each hit names its cut. The rest is as before.
  it('plans from the v1 pack exactly as before', async () => {
    for (const item of PACK) await writeFile(join(dir, item.file), item.id);
    const tl = timeline(
      [45, 45, 45, 45, 45, 45, 60, 45],
      ['whip', 'zoom', 'flash', 'dissolve', null, 'slide', null],
    );
    const { sfx, sink } = service(null);
    const made = await sfx.addHits({ timeline: tl, density: 'everyCut' });
    if (!made.ok) throw new Error(made.error.code);
    const keys = 'assetId,at,category,cut,duration,gainDb,id,sourceStart';
    expect(made.value.payload.hits.map(shape)).toEqual([
      { at: 1080, cut: 1500, sourceStart: 0, duration: 470, gainDb: -14, category: 'whoosh', keys },
      { at: 1550, cut: 3000, sourceStart: 50, duration: 1435, gainDb: -14, category: 'riser', keys },
      { at: 2985, cut: 3000, sourceStart: 0, duration: 900, gainDb: -14, category: 'impact', keys },
      { at: 4485, cut: 4500, sourceStart: 0, duration: 900, gainDb: -14, category: 'impact', keys },
      { at: 7495, cut: 7500, sourceStart: 0, duration: 300, gainDb: -18, category: 'hit', keys },
      { at: 8650, cut: 9000, sourceStart: 0, duration: 700, gainDb: -14, category: 'whoosh', keys },
      { at: 10995, cut: 11000, sourceStart: 0, duration: 300, gainDb: -18, category: 'hit', keys },
    ]);
    expect([...sink.files.values()].map((f) => f.provenance)).toEqual(
      ['whoosh-a', 'riser-a', 'impact-a', 'hit-a', 'whoosh-b'].map((id) => ({
        kind: 'bundled',
        pack: 'sfx-pack',
        itemId: id,
        licence: 'CC0-1.0',
        sourceUrl: 'https://example.org/cc0',
        title: id,
      })),
    );
  });
});

describe('addHits from bank sounds (EAR1-D2)', () => {
  const whoosh = bankItem({
    takes: [
      bankTake({ file: 'whoosh_fast.crisp_s7.flac', apexMs: 210.25 }),
      bankTake({ file: 'whoosh_fast.crisp_s8.flac', seed: 8, plannedSeed: 8, apexMs: 198.5 }),
    ],
  });
  const tick = fitItem();

  async function installed() {
    await writeCatalogue(
      dir,
      bankCatalogue([whoosh, tick], {
        withheld: [{ id: 'pro_zip/up_hi', upstreamId: 'pro_zip/up_hi', warnings: ['rising_glide'] }],
      }),
    );
    for (const item of [whoosh, tick])
      for (const take of item.takes) await writeFile(join(dir, take.file), take.file);
    return dir;
  }

  it('lands each take’s apex on its cut, names the sound and keeps its licence', async () => {
    const { sfx, sink } = service(await installed());
    const tl = timeline([45, 45, 60, 45], ['whip', null, 'whip']);
    const made = await sfx.addHits({
      timeline: tl,
      density: 'everyCut',
      soundIds: ['whoosh_fast/crisp', 'fit/tick/domino'],
    });
    if (!made.ok) throw new Error(`${made.error.code} ${made.error.detail ?? ''}`);
    const hits = made.value.payload.hits;
    expect(hits.map((h) => [h.category, h.soundId, h.kitRole])).toEqual([
      ['whoosh', 'whoosh_fast/crisp', undefined],
      ['hit', 'fit/tick_domino', undefined],
      ['whoosh', 'whoosh_fast/crisp', undefined],
    ]);
    // Cuts at 1500, 3000 and 5000 ms; each file has 50 ms of silence before its sound.
    const apexes = [210.25, 7.5, 198.5];
    hits.forEach((hit, i) => {
      const landed =
        RationalTime.toSeconds(hit.at) * 1000 - RationalTime.toSeconds(hit.sourceStart) * 1000 + 50;
      expect(Math.abs(landed + (apexes[i] ?? 0) - [1500, 3000, 5000][i]!)).toBeLessThanOrEqual(0.5);
    });
    const stored = [...sink.files.values()];
    expect(stored.map((f) => [f.provenance.kind === 'bundled' && f.provenance.pack, f.mediaType])).toEqual([
      ['sfx-bank', 'audio/flac'],
      ['sfx-bank', 'audio/flac'],
      ['sfx-bank', 'audio/flac'],
    ]);
    // D22: a fitted sound is a code-made render too: MIT, checked against fit.json, not its CC0 recording.
    expect(stored.map((f) => (f.provenance.kind === 'bundled' ? f.provenance.licence : null))).toEqual([
      'MIT',
      'MIT',
      'MIT',
    ]);
    expect(stored[1]?.provenance).toMatchObject({ sourceUrl: fitItem().sourceUrl });
  });

  it('refuses a sound that isn’t in the bank or was withheld, and answers a bank not installed', async () => {
    const { sfx } = service(await installed());
    const tl = timeline([45, 45], ['whip']);
    for (const soundIds of [['whoosh_fast/nope'], ['pro_zip/up_hi']]) {
      const made = await sfx.addHits({ timeline: tl, soundIds });
      expect(made.ok ? 'ok' : made.error.code).toBe('audio.kit_invalid');
    }
    const missing = await service(null).sfx.addHits({ timeline: tl, soundIds: ['whoosh_fast/crisp'] });
    expect(missing.ok ? 'ok' : missing.error.code).toBe('audio.sfx_bank_missing');
  });
});
