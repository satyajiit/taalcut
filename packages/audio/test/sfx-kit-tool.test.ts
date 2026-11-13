// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-D3: `sfx.addHits` 2.0's contract. Its metadata passes the registry checks with a one-line summary; a
 * version 1 input parses and keys exactly as before, while the key changes with the kit and the sound ids; it takes
 * a preset, a kit file, bank sounds and roles, passes them to the service and refuses what isn't one. On the
 * installed bank, a kit's takes land by their role's sync point and offset, and a take with knobs reaches the
 * library as a WAV.
 */
import { createHash } from 'node:crypto';
import {
  err,
  FrameRate,
  MIX_COMMANDS,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  toolModuleProblems,
  type CommandToolContext,
  type SequenceItem,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { TransitionKind } from '../src/sfx/cuts';
import { createSfxService } from '../src/sfx/hits-service';
import { createSignalsmithStretcher, loadSignalsmithModule } from '../src/stretch/signalsmith';
import { sfxToolModule } from '../src/tools/sfx-tools';
import { memoryTimelineStore } from './helpers/bus';
import { testMedia } from './helpers/ffmpeg';
import { memorySink } from './helpers/sinks';
import { makeTestTimeline, steadyBeatMap } from './helpers/timeline';
import { HAS_BANK, INSTALLED_BANK, installedBank } from './sfx-bank-helpers';

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

const tl = timeline([60, 60, 60, 60], ['whip', 'flash', null]);
const target = { projectId: tl.projectId, timelineId: tl.id };
const prices = { voicePerCharacter: () => 0, musicPerSecond: () => 0, sfxPerSecond: () => 0.002 };
const context = (dispatched: unknown[]): CommandToolContext =>
  ({
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    reportUsage: () => undefined,
    reportProgress: () => undefined,
    dispatch: async (payload: unknown) => {
      dispatched.push(payload);
      return ok({ timelineId: 'x', revision: 2 });
    },
  }) as unknown as CommandToolContext;

function addHitsTool(
  addHits = async (_: unknown) => ok({ payload: { ...target, revision: 1, hits: [] }, costUsd: 0 }),
) {
  const module = sfxToolModule({
    service: { addHits: addHits as never, generateHit: async () => err(NotFoundError({ entity: 'x' })) },
    timelines: memoryTimelineStore(tl),
    prices,
  });
  const tool = module.tools.find((t) => t.name === 'sfx.addHits');
  if (!tool) throw new Error('no sfx.addHits');
  return { module, tool };
}

describe('sfx.addHits 2.0 (EAR1-D3)', () => {
  it('declares its metadata, a one-line summary and the setHits command', () => {
    const { module, tool } = addHitsTool();
    expect(toolModuleProblems(module)).toEqual([]);
    expect(tool.version).toBe('2.0.0');
    expect(tool.summary?.length ?? 0).toBeLessThanOrEqual(80);
    expect(tool.summary).not.toMatch(/\n/);
    expect(tool.command).toBe(MIX_COMMANDS.setHits);
    expect([tool.costClass, tool.sideEffect, tool.permission?.network]).toEqual(['local', 'write', 'none']);
    expect(tool.timeoutMs).toBeGreaterThanOrEqual(15_000);
    expect(tool.idempotencyKey).toBeTypeOf('function');
  });

  it('parses and keys a version 1 input as before; the kit and sound ids change the key', () => {
    const { tool } = addHitsTool();
    const v1 = tool.input.parse(target);
    expect(v1).toEqual({ ...target, density: 'downbeats' });
    const before = `sfx.addHits:${createHash('sha256')
      .update(JSON.stringify({ ...target, density: 'downbeats' }))
      .digest('hex')}`;
    expect(tool.idempotencyKey?.(v1)).toBe(before);
    const keys = [
      { ...target, kit: 'calm' },
      { ...target, kit: 'crisp' },
      { ...target, soundIds: ['cut_hit/sub'] },
      { ...target, soundIds: ['cut_hit/kick'] },
      { ...target, kit: 'calm', roles: { hit: 'tick' } },
    ].map((input) => tool.idempotencyKey?.(tool.input.parse(input)));
    expect(new Set([before, ...keys]).size).toBe(6);
  });

  it('takes presets, kit files, bank sounds and roles, and refuses what isn’t one', () => {
    const { tool } = addHitsTool();
    const ok = [
      { kit: 'launch' },
      {
        kit: {
          kit: 1,
          roles: { hit: { sound: 'cut_hit/sub', takes: 2, edits: { pitch: 'A1' } }, riser: null },
        },
      },
      { soundIds: ['whoosh_fast/crisp', 'fit/tick/domino', 'fit/tick_domino'] },
      { kit: 'calm', roles: { hit: 'tock', impact: 'drop' } },
    ];
    for (const input of ok)
      expect(tool.input.safeParse({ ...target, ...input }).success, JSON.stringify(input)).toBe(true);
    const bad = [
      { kit: 'loud' },
      { kit: { kit: 2, roles: {} } },
      { kit: { kit: 1, roles: { hit: { sound: 'cut_hit/sub', volume: 2 } } } },
      { soundIds: ['../etc/passwd'] },
      { soundIds: [] },
      { roles: { hit: 'Hit' } },
    ];
    for (const input of bad)
      expect(tool.input.safeParse({ ...target, ...input }).success, JSON.stringify(input)).toBe(false);
  });

  it('passes the kit, the sounds and the roles to the service, and dispatches sfx.setHits', async () => {
    const seen: unknown[] = [];
    const { tool } = addHitsTool(async (request) => {
      seen.push(request);
      return ok({ payload: { ...target, revision: 1, hits: [] }, costUsd: 0 });
    });
    const dispatched: unknown[] = [];
    const input = tool.input.parse({
      ...target,
      kit: 'calm',
      soundIds: ['cut_hit/sub'],
      roles: { hit: 'tock' },
    });
    const done = await tool.run(input, context(dispatched));
    expect(done.ok && done.value).toEqual({ hits: 0 });
    expect(seen).toMatchObject([
      { kit: 'calm', soundIds: ['cut_hit/sub'], roles: { hit: 'tock' }, density: 'downbeats' },
    ]);
    expect(dispatched).toHaveLength(1);
  });
});

const found = await testMedia('sfx kit hits');
const signalsmith = await loadSignalsmithModule();

describe.skipIf(!HAS_BANK || !found.ctx || !signalsmith.ok)('kits on the timeline (EAR1-D3)', () => {
  function service() {
    const sink = memorySink();
    const sfx = createSfxService({
      pack: { load: async () => err(NotFoundError({ entity: 'pack' })) },
      bankDir: () => INSTALLED_BANK,
      sink,
      ...(signalsmith.ok ? { stretcher: createSignalsmithStretcher(signalsmith.value) } : {}),
      provider: {} as never,
      media: found.ctx as never,
      meter: {} as never,
      clock: { now: () => 0 } as never,
    });
    return { sfx, sink };
  }
  const landedMs = (hit: { at: RationalTime; sourceStart: RationalTime }, pad: number) =>
    RationalTime.toSeconds(hit.at) * 1000 - RationalTime.toSeconds(hit.sourceStart) * 1000 + pad;

  it('places a preset’s takes by their role’s sync point and offset', { timeout: 120_000 }, async () => {
    const bank = await installedBank();
    const pad = bank.catalogue.padMs;
    for (const preset of ['calm', 'launch'] as const) {
      const made = await service().sfx.addHits({ timeline: tl, density: 'everyCut', kit: preset });
      if (!made.ok) throw new Error(`${made.error.code} ${made.error.detail ?? ''}`);
      const hits = made.value.payload.hits;
      expect(
        hits.map((h) => [h.category, h.kitRole]),
        preset,
      ).toEqual([
        ['whoosh', 'whoosh.short'],
        ['impact', 'hit'],
        ['hit', 'land'],
      ]);
      const offsets = preset === 'launch' ? [37, 0, 30] : [0, 0, 0];
      hits.forEach((hit, i) => {
        const item = bank.item(hit.soundId ?? '');
        expect(item, hit.soundId).toBeDefined();
        const anchor = hit.category === 'whoosh' ? 'apexMs' : 'onsetMs';
        const cut = [2000, 4000, 6000][i] ?? 0;
        // Some take of the sound has its sync point within half a millisecond of the cut plus the role's offset.
        const lands = (item?.takes ?? []).some(
          (t) => Math.abs(landedMs(hit, pad) + t[anchor] - (cut + (offsets[i] ?? 0))) <= 0.5,
        );
        expect(lands, `${preset} ${hit.kitRole}`).toBe(true);
      });
    }
  });

  it('keeps a role’s two pitches as two takes (EAR1-R2)', { timeout: 120_000 }, async () => {
    const { sfx, sink } = service();
    // −3 dB: an edited take (the bank has the plain C5 and E5), rendered here and named by its role and pitch.
    const hit = { sound: 'pluck/kalimba', pitches: ['C5', 'E5'], edits: { peak_db: -3 } };
    const kit = { kit: 1, roles: { hit, land: null } };
    const flashes = timeline([60, 60, 60, 60], ['flash', 'flash', 'flash']);
    const made = await sfx.addHits({ timeline: flashes, density: 'everyCut', kit, roles: { impact: 'hit' } });
    if (!made.ok) throw new Error(`${made.error.code} ${made.error.detail ?? ''}`);
    const assets = made.value.payload.hits.map((h) => h.assetId);
    // Taken in turn: C5, E5, C5; before, both pitches shared one id and every cut got the same take.
    expect(new Set(assets).size).toBe(2);
    expect(assets[0]).toBe(assets[2]);
    expect([...sink.files.values()].map((f) => f.provenance)).toMatchObject([
      { itemId: expect.stringContaining('_hit_C5_') },
      { itemId: expect.stringContaining('_hit_E5_') },
    ]);
  });

  it('renders a take with knobs into a WAV in the library', { timeout: 120_000 }, async () => {
    const { sfx, sink } = service();
    const kit = {
      kit: 1,
      roles: { hit: { sound: 'cut_hit/sub', edits: { pitch: 'A1', peak_db: -3 } }, land: null },
    };
    const made = await sfx.addHits({
      timeline: tl,
      density: 'everyCut',
      kit,
      roles: { whoosh: 'none', impact: 'hit' },
    });
    if (!made.ok) throw new Error(`${made.error.code} ${made.error.detail ?? ''}`);
    expect(made.value.payload.hits.map((h) => [h.category, h.kitRole, h.soundId])).toEqual([
      ['impact', 'hit', 'cut_hit/sub'],
    ]);
    const [stored] = [...sink.files.values()];
    expect(stored?.mediaType).toBe('audio/wav');
    expect(stored?.provenance).toMatchObject({ kind: 'bundled', pack: 'sfx-bank', licence: 'MIT' });
  });
});
