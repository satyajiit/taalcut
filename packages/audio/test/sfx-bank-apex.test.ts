// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-D2's acceptance: a bank sound's loudest 5 ms lands within 2.5 ms of its cut. Over the whole installed
 * catalogue (every take, pitched and widened ones too), each take is planned onto a cut by the planner, turned into
 * the `sfx.setHits` record and then into the clip the command writes (first frame at or after the hit, skipping
 * into the sound by the difference), rendered into a timeline-length buffer, and earshot's loudest 5 ms (1 ms hop,
 * F6's `takeTimes`) is measured on that rendered audio. Once mid-timeline and once on a cut too near the start for
 * the sound's lead-in. Skipped where the bank hasn't been built or FFmpeg is absent.
 *
 * "Loudest 5 ms" is measured as the bank defines a take's apex (bank-apex.ts: the 5 ms window at every sample).
 * earshot's own 1 ms grid (F6's `takeTimes`) starts at the file's first sample, and a clip starts on a frame, a
 * fraction of a millisecond off any grid the sound was measured on: a pass with near-equal maxima can then read
 * another of them (earshot's SFX.md says so of whoosh_big). That figure is logged, not asserted.
 */
import { FrameRate, newId, RationalTime, type AssetId, type SfxCategory } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { takeTimes } from '../src/listen/dsp/audit-shape';
import { apexSeconds } from '../src/sfx/bank-apex';
import { bankHitRecords, bankPick, type BankPick } from '../src/sfx/bank-hits';
import type { Cut, TransitionKind } from '../src/sfx/cuts';
import { planHits } from '../src/sfx/hit-plan';
import { hitSound } from '../src/sfx/hits-command';
import { testMedia } from './helpers/ffmpeg';
import { decodeTake, HAS_BANK, installedBank, meanMono } from './sfx-bank-helpers';

const RATE = FrameRate.of(30);
const SR = 48_000;
const TRANSITION: Record<SfxCategory, TransitionKind | null> = {
  whoosh: 'whip',
  riser: 'zoom',
  impact: 'flash',
  hit: null,
};

const found = await testMedia('sfx bank apex');

/** Where the take's loudest 5 ms lands on a rendered timeline with this one sound cut at `cutFrame`, ms. */
function landed(
  pick: BankPick,
  take: readonly Float32Array[],
  cutFrame: number,
): { apexMs: number; gridMs: number } | null {
  const cutMs = (cutFrame * 1000) / 30;
  const cut: Cut = {
    index: 0,
    frame: cutFrame,
    ms: cutMs,
    transition: TRANSITION[pick.sound.category],
    onDownbeat: true,
  };
  const timelineMs = cutMs + pick.sound.durationMs + 500;
  const planned = planHits({ cuts: [cut], items: [pick.sound], timelineMs, density: 'everyCut' });
  const assets = new Map<string, AssetId>([[pick.takeId, newId<'Asset'>()]]);
  const [hit] = bankHitRecords(planned, new Map([[pick.sound.id, pick]]), assets);
  if (!hit) return null;
  const clip = hitSound(hit, RATE);
  const out = new Float64Array(Math.ceil((timelineMs * SR) / 1000) + SR);
  const at = Math.round((clip.startFrame * SR) / 30);
  const from = Math.round(RationalTime.toSeconds(clip.sourceStart) * SR);
  const length = Math.round((clip.durationFrames * SR) / 30);
  const mono = meanMono(take);
  for (let i = 0; i < length && from + i < mono.length && at + i < out.length; i++)
    out[at + i] = mono[from + i] ?? 0;
  return { apexMs: apexSeconds(out) * 1000, gridMs: takeTimes(out).peakS * 1000 };
}

describe.skipIf(!HAS_BANK || !found.ctx)('the SFX bank on cuts (EAR1-D2)', () => {
  it('lands every take’s loudest 5 ms within 2.5 ms of its cut, rendered', { timeout: 300_000 }, async () => {
    const media = found.ctx;
    if (!media) return;
    const bank = await installedBank();
    const misses: string[] = [];
    let worst = 0;
    let gridWorst = 0;
    let gridOver = 0;
    let placed = 0;
    for (const item of bank.items)
      for (const take of item.takes) {
        const pick = bankPick(bank, item, take, item.family);
        const audio = await decodeTake(media, bank.pathOf(take));
        // Mid-timeline, and a cut 233 ms in: a long lead-in is skipped into, the apex still on the cut.
        for (const frame of [150, 7]) {
          const at = landed(pick, audio, frame);
          if (at === null) {
            misses.push(`${take.file} @${frame}: not placed`);
            continue;
          }
          const error = Math.abs(at.apexMs - (frame * 1000) / 30);
          const grid = Math.abs(at.gridMs - (frame * 1000) / 30);
          worst = Math.max(worst, error);
          gridWorst = Math.max(gridWorst, grid);
          if (grid > 2.5) gridOver++;
          placed++;
          if (error > 2.5) misses.push(`${take.file} @${frame}: ${error.toFixed(2)} ms`);
        }
      }
    console.warn(
      `sfx-bank apex: ${placed} placements, worst ${worst.toFixed(2)} ms; on earshot's 1 ms grid ` +
        `${gridOver} over 2.5 ms (worst ${gridWorst.toFixed(1)} ms)`,
    );
    expect(misses).toEqual([]);
    expect(placed).toBe(bank.items.reduce((n, item) => n + item.takes.length, 0) * 2);
  });
});
