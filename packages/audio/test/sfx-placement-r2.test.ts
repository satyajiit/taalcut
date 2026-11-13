// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R2's placement fixes, and EAR1-K3's cut on each hit:
 * - overlaps resolve in apex order: an earlier-starting take of a later cut no longer trims the earlier cut's sound
 *   before its apex; it starts later, skipping into itself, its own apex still on its cut (P1);
 * - `sfx.addHits` with bank sounds that fit no cut is refused, never an empty `sfx.setHits` (T3);
 * - `roles` without a kit is refused (T8);
 * - a kit's edited takes of one role at two pitches get two ids (T5);
 * - each placed hit names its cut, its clip keeps it as its sync point, and a read-back hit gets it again.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  err,
  FrameRate,
  MIX_COMMANDS,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  type CommandToolContext,
  type SfxHit,
} from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Cut } from '../src/sfx/cuts';
import { planHits, withoutOverlaps, type HitSound, type PlannedHit } from '../src/sfx/hit-plan';
import { existingHits, toHits } from '../src/sfx/hit-records';
import { createSfxCommands, hitSound } from '../src/sfx/hits-command';
import { createSfxService } from '../src/sfx/hits-service';
import { editedTakeId } from '../src/sfx/kits/picks';
import type { PlannedTake } from '../src/sfx/kits/render-take';
import { sfxToolModule } from '../src/tools/sfx-tools';
import { busWith, memoryTimelineStore, UI } from './helpers/bus';
import { memorySink } from './helpers/sinks';
import { makeTestTimeline } from './helpers/timeline';
import { bankCatalogue, bankItem, bankTake, writeCatalogue } from './sfx-bank-helpers';

const cut = (index: number, ms: number, transition: Cut['transition']): Cut => ({
  index,
  frame: Math.round((ms * 30) / 1000),
  ms,
  transition,
  onDownbeat: true,
});
/** Where a planned sound's apex (`peakMs`) plays on the timeline, and whether it plays at all. */
const apexOf = (hit: PlannedHit) => {
  const at = hit.startMs - hit.sourceStartMs + hit.item.peakMs;
  return { at, played: at >= hit.startMs && at < hit.startMs + hit.durationMs };
};

describe('overlaps in apex order (P1)', () => {
  // A bank hit (60 ms lead-in) on the first cut, a whoosh take (650 ms lead-in) on a whip 450 ms later: the whoosh
  // starts first. Trimmed by start, the whoosh stopped at 940 ms, where the hit starts, 510 ms before its apex.
  const items: HitSound[] = [
    { id: 'hit-take', category: 'hit', durationMs: 220, peakMs: 60, loudnessLufs: -14, anchorMs: 60 },
    {
      id: 'whoosh-take',
      category: 'whoosh',
      durationMs: 1000,
      peakMs: 650,
      loudnessLufs: -14,
      anchorMs: 650,
    },
  ];
  const cuts = [cut(0, 1000, null), cut(1, 1450, 'whip')];

  it('keeps every apex on its cut: the earlier keeps its apex and a tail, the later skips into itself', () => {
    const plan = planHits({ cuts, items, timelineMs: 5000, density: 'everyCut' });
    expect(plan.map((h) => [h.item.id, apexOf(h)])).toEqual([
      ['hit-take', { at: 1000, played: true }],
      ['whoosh-take', { at: 1450, played: true }],
    ]);
    const [hit, whoosh] = plan;
    // The hit plays to its apex plus 50 ms; the whoosh starts there, 250 ms into itself.
    expect(hit).toMatchObject({ startMs: 940, durationMs: 110 });
    expect(whoosh).toMatchObject({ startMs: 1050, sourceStartMs: 250, durationMs: 750 });
  });

  it('leaves sounds that don’t overlap as they were, and a zoom’s riser still gives way to its impact', () => {
    const apart = [
      { id: 'a', category: 'whoosh', durationMs: 300, peakMs: 150, loudnessLufs: -16 },
      { id: 'b', category: 'impact', durationMs: 300, peakMs: 10, loudnessLufs: -16 },
    ] satisfies HitSound[];
    const plan = planHits({
      cuts: [cut(0, 1000, 'whip'), cut(1, 2000, 'flash')],
      items: apart,
      timelineMs: 5000,
      density: 'everyCut',
    });
    expect(withoutOverlaps(plan)).toEqual(plan);
    expect(plan.map((h) => [h.startMs, h.sourceStartMs, h.durationMs])).toEqual([
      [850, 0, 300],
      [1990, 0, 300],
    ]);
    const zoom = planHits({
      cuts: [cut(0, 3000, 'zoom')],
      items: [
        { id: 'riser', category: 'riser', durationMs: 1500, peakMs: 1499, loudnessLufs: -16 },
        { id: 'impact', category: 'impact', durationMs: 900, peakMs: 15, loudnessLufs: -16 },
      ],
      timelineMs: 9000,
    });
    expect(zoom.map((h) => [h.item.id, h.startMs, h.durationMs])).toEqual([
      ['riser', 1500, 1485],
      ['impact', 2985, 900],
    ]);
  });
});

describe('the cut each hit was placed for (EAR1-K3)', () => {
  const tl = makeTestTimeline({
    rate: FrameRate.of(30),
    clips: [{ frames: 45 }, { frames: 45 }, { frames: 45 }],
  });
  const whoosh: HitSound = { id: 'w', category: 'whoosh', durationMs: 800, peakMs: 420, loudnessLufs: -16 };

  it('a placed whoosh names its cut, its clip carries the sync point on it, and reads back with it', async () => {
    const plan = planHits({ cuts: [cut(0, 1500, 'whip')], items: [whoosh], timelineMs: 4500 });
    const assetId = newId<'Asset'>();
    const [hit] = toHits(plan, new Map([['w', assetId]]));
    expect(hit?.cut).toEqual(RationalTime.of(1500, { num: 1000, den: 1 }));
    const clip = hitSound(hit as SfxHit, tl.canvas.rate);
    // 1080 ms is frame 32.4: the clip starts on frame 33, 20 ms into the sound; the cut is 420 ms into it.
    expect(clip.startFrame).toBe(33);
    expect(RationalTime.toSeconds(clip.syncPoint!) * 1000).toBeCloseTo(420, 9);
    // Render QA's reading (render engine/stages/qa-facts.ts plannedEffect): start + (syncPoint − sourceIn) frames.
    const into = RationalTime.toSeconds(clip.syncPoint!) - RationalTime.toSeconds(clip.sourceStart);
    expect(clip.startFrame + Math.round(into * 30)).toBe(45);
    const store = memoryTimelineStore(tl);
    const { bus } = busWith(store, (deps) => createSfxCommands(deps).all);
    const set = await bus.dispatch(
      MIX_COMMANDS.setHits,
      { projectId: tl.projectId, timelineId: tl.id, hits: [hit as SfxHit] },
      UI,
    );
    expect(set.ok).toBe(true);
    const [back] = existingHits(store.current(tl.id));
    expect(RationalTime.toSeconds(back!.cut!) * 1000).toBeCloseTo(1500, 9);
    // Written again, the clip keeps the same sync point.
    expect(hitSound(back!, tl.canvas.rate).syncPoint).toEqual(clip.syncPoint);
    expect(clip.syncPoint?.rate).toEqual({ num: 1000, den: 1 });
  });

  it('a hit without a cut, or whose cut it doesn’t play, has no sync point, as before', () => {
    const ms = (v: number) => RationalTime.of(v, { num: 1000, den: 1 });
    const base = {
      id: newId<'TimelineItem'>(),
      at: ms(1080),
      assetId: newId<'Asset'>(),
      sourceStart: ms(0),
      duration: ms(800),
      gainDb: -14,
      category: 'whoosh' as const,
    };
    expect(hitSound(base, tl.canvas.rate).syncPoint).toBeNull();
    expect(hitSound({ ...base, cut: ms(3000) }, tl.canvas.rate).syncPoint).toBeNull();
  });
});

describe('sfx.addHits refuses what it can’t place (T3, T8)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-sfx-r2-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  // Hard cuts only: a whoosh goes on whip pans and slides, so no cut takes it.
  const tl = makeTestTimeline({
    rate: FrameRate.of(30),
    clips: [{ frames: 60 }, { frames: 60 }, { frames: 60 }],
  });

  function tool() {
    const sfx = createSfxService({
      pack: { load: async () => err(NotFoundError({ entity: 'pack' })) },
      bankDir: () => dir,
      sink: memorySink(),
      provider: {} as never,
      media: { binaries: {} } as never,
      meter: {} as never,
      clock: { now: () => 0 } as never,
    });
    const module = sfxToolModule({
      service: sfx,
      timelines: memoryTimelineStore(tl),
      prices: { voicePerCharacter: () => 0, musicPerSecond: () => 0, sfxPerSecond: () => 0 },
    });
    return module.tools.find((t) => t.name === 'sfx.addHits')!;
  }

  it('fails with audio.sfx_no_fitting_cuts instead of clearing the effects track', async () => {
    await writeCatalogue(dir, bankCatalogue([bankItem()]));
    await writeFile(join(dir, bankTake().file), 'flac');
    const dispatched: unknown[] = [];
    const ctx = {
      signal: new AbortController().signal,
      callId: newId<'ToolRun'>(),
      attempt: 1,
      reportUsage: () => undefined,
      reportProgress: () => undefined,
      dispatch: async (payload: unknown) => {
        dispatched.push(payload);
        return ok({ timelineId: tl.id, revision: 2 });
      },
    } as unknown as CommandToolContext;
    const addHits = tool();
    const input = addHits.input.parse({
      projectId: tl.projectId,
      timelineId: tl.id,
      density: 'everyCut',
      soundIds: ['whoosh_fast/crisp'],
    });
    const done = await addHits.run(input, ctx);
    expect(done.ok ? 'ok' : done.error.code).toBe('audio.sfx_no_fitting_cuts');
    expect(dispatched).toEqual([]);
  });

  it('refuses roles without a kit', () => {
    const parsed = tool().input.safeParse({
      projectId: tl.projectId,
      timelineId: tl.id,
      soundIds: ['whoosh_fast/crisp'],
      roles: { hit: 'tock' },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('edited kit takes (T5)', () => {
  const planned = (pitch: string | null, k = 1, width?: number): PlannedTake => ({
    role: 'bell',
    file: 'bell.wav',
    sound: 'pluck/kalimba',
    seed: 3,
    pitch,
    edits: {},
    maxS: null,
    k,
    ...(width !== undefined ? { width } : {}),
  });

  it('names each pitch and width, so two pitches of one role don’t share an id', () => {
    const ids = [planned('C5'), planned('E5'), planned('Db5'), planned('C5', 2), planned('C5', 1, 0.6)].map(
      (p) => editedTakeId('pluck.kalimba_s3', p),
    );
    expect(ids).toEqual([
      'pluck.kalimba_s3_bell_C5_1',
      'pluck.kalimba_s3_bell_E5_1',
      'pluck.kalimba_s3_bell_Cs5_1',
      'pluck.kalimba_s3_bell_C5_2',
      'pluck.kalimba_s3_bell_C5_w0p6_1',
    ]);
    const long = editedTakeId('x'.repeat(60), planned('C5'));
    expect(long).toHaveLength(64);
    expect(long).not.toBe(editedTakeId('x'.repeat(60), planned('E5')));
    expect(editedTakeId('t', planned('450hz'))).toBe('t_bell_450hz_1');
  });
});
