// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G1: `sfx.addHits` fromTemplate in the agent process (agent-audio-reel.ts). A fixture template whose reel had
 * effects on its cuts (`audio.listening.sfxAtCuts`) gives a video made from it one `sfx.setHits` with a bank take on
 * each of the same cut indices, its loudest moment where the reel's effect was (the cut plus the reel's offset).
 * Through the agent's registry the tool reads the template the timeline names and the `sfx-bank` component this
 * Mac installed. Where no effects can go on, the error says why. A small bank of the C2 test's shape stands in for
 * the built one; the template is a planned format with the listening written in.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MIX,
  err,
  GeneratedAssetSinkToken,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  SFX_CATEGORIES,
  TemplateStoreToken,
  TIMELINE_SCHEMA_VERSION,
  TimelineStoreToken,
  templateSchema,
  timelineSchema,
  unwrap,
  type AssetId,
  type Container,
  type GeneratedAssetSink,
  type SfxAtCut,
  type SfxCategory,
  type Template,
  type TemplateStore,
  type Timeline,
  type TimelineStore,
  type ToolContextBase,
} from '@taalcut/core';
import { loadSfxBank, sfxBankSource, type SfxBank, type SfxBankTake } from '@taalcut/audio';
import { planFormat } from '@taalcut/templates';
import { createToolRegistry } from '@taalcut/tools';
import { withAudioTools } from '../src/utility/roots/agent-audio';
import { reelTemplateHits } from '../src/utility/roots/agent-audio-reel';
import { testAgent, testConfig } from './helpers/roots';

const root = mkdtempSync(join(tmpdir(), 'taalcut-agent-reel-'));
const open: Container[] = [];
afterEach(async () => {
  for (const container of open.splice(0)) await container.dispose();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const MS = { num: 1000, den: 1 } as const;
const SHAPES: Record<SfxCategory, { apex: number; length: number; title: string }> = {
  whoosh: { apex: 210, length: 500, title: 'Whoosh fast, air' },
  riser: { apex: 1480, length: 1500, title: 'Riser, uplifter sweep' },
  impact: { apex: 8, length: 900, title: 'Impact, deep boom' },
  hit: { apex: 4, length: 250, title: 'Hit, soft tap' },
};

/** The C2 test's small bank, one sound a family with two takes, written as the component installs it. */
function writeBank(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const items = SFX_CATEGORIES.map((family) => {
    const { apex, length, title } = SHAPES[family];
    const takes = [0, 1].map((k) => ({
      file: `${family}_s${k}.flac`,
      ...{ seed: 1, plannedSeed: 1, auditRole: null, pitch: null, width: null, bits: 16, channels: 2 },
      frames: length * 48,
      durationMs: length,
      onsetMs: Math.max(0, apex + k - 2),
      apexMs: apex + k,
      peakMs: apex + k,
      endMs: length - 5,
      peakDb: -1,
      loudnessLufs: -14,
      pcmSha256: 'a'.repeat(64),
      audit: { ok: true, findings: [] },
    }));
    for (const take of takes) writeFileSync(join(dir, take.file), 'fLaC');
    return {
      ...{
        id: `${family}_a/plain`,
        upstreamId: `${family}_a/plain`,
        category: `${family}_a`,
        member: 'plain',
      },
      ...{
        seed: 1,
        title,
        family,
        kinds: [family],
        source: 'forge_v2',
        licence: 'MIT',
        credit: null,
        notes: '',
      },
      sourceUrl: 'https://github.com/Leonxlnx/earshot',
      provenance: "Rendered from earshot's recipe code (MIT).",
      knobs: { dur: 'shape', apex: true, pitch: null },
      takes,
    };
  });
  const upstream = {
    repository: 'https://github.com/Leonxlnx/earshot',
    commit: 'ff41f0788ae56896fd59879ab03858d223c06a53',
    version: '0.4.0',
    bank: 'test',
  };
  const catalogue = { version: 1, pack: 'sfx-bank', packVersion: 'test', upstream, sampleRate: 48_000 };
  writeFileSync(
    join(dir, 'catalogue.json'),
    JSON.stringify({ ...catalogue, padMs: 50, items, withheld: [], embeddings: [] }),
  );
}

/** A planned format with the reel's listening: an effect on every other cut, each family in turn. */
function reelTemplate(): Template {
  const base = unwrap(
    planFormat(
      { formatId: 'vlog', targetSeconds: 20, brief: 'a slow morning', createdAt: 1 },
      { template: () => newId(), slot: () => newId(), overlay: () => newId() },
    ),
  );
  const offsets: Record<SfxCategory, number> = { whoosh: -20, impact: 4, riser: -60, hit: 0 };
  const effects: SfxAtCut[] = base.slots.flatMap((_, slot) => {
    if (slot % 2 === 0) return [];
    const family = SFX_CATEGORIES[((slot - 1) / 2) % SFX_CATEGORIES.length]!;
    return [{ cutIndex: slot, family, offsetMs: offsets[family], soundHint: `a ${family}` }];
  });
  const items = base.slots.slice(1).map((slot, i) => {
    const effect = effects.find((candidate) => candidate.cutIndex === i + 1);
    return effect
      ? { cutIndex: i + 1, at: slot.start, status: 'ok' as const, offsetMs: effect.offsetMs }
      : { cutIndex: i + 1, at: slot.start, status: 'none' as const, offsetMs: null };
  });
  const missed = items.filter((item) => item.status === 'none').map((item) => item.cutIndex);
  const share = (items.length - missed.length) / items.length;
  const durationMs = RationalTime.toSeconds(base.duration) * 1000;
  return templateSchema.parse({
    ...base,
    audio: {
      ...base.audio,
      listening: {
        version: 1,
        model: null,
        measures: {
          ...{
            duration: RationalTime.of(Math.round(durationMs), MS),
            lufs: -14,
            truePeakDbtp: -1,
            peakDbfs: -1,
          },
          ...{ lraLu: null, crestLu: null, noiseFloorDbfs: -60, nearSilent: false, bandwidthHz: null },
          ...{ brightnessHz: null, bands: null, sideToMidDb: null },
        },
        events: [],
        sections: [],
        cutSync: {
          ...{ items, cutsWithoutHit: missed, okShare: share, nearShare: share, chanceShare: 0.1 },
          ...{ medianOffsetMs: 20, toleranceMs: 40 },
        },
        sfxAtCuts: effects,
      },
    },
  });
}

/** A video made from the template: one clip per slot, its length. */
function madeTimeline(template: Template, slots = template.slots): Timeline {
  const rate = template.canvas.rate;
  const at = (frames: number) => RationalTime.of(frames, rate);
  const items = slots.map((slot) => ({
    ...{ type: 'clip', id: newId<'TimelineItem'>(), sourceStart: at(0), duration: at(slot.duration.value) },
    media: {
      ...{ kind: 'video', assetId: newId<'Asset'>(), shotId: null },
      available: { start: at(0), duration: at(slot.duration.value + 60) },
    },
    ...{ speed: null, slotId: slot.id, syncPoint: null, beatAnchor: null, fit: 'cover', locked: false },
    ...{ audio: { gainDb: 0, muted: false }, enabled: true, stillMotion: null, reframe: null },
  }));
  return timelineSchema.parse({
    ...{ schemaVersion: TIMELINE_SCHEMA_VERSION, id: newId<'Timeline'>(), projectId: newId<'Project'>() },
    ...{ name: 'Made from the reel', revision: 3, canvas: { width: 1080, height: 1920, rate } },
    template: { id: template.id, version: template.version },
    ...{ beatMap: null, markers: [], cast: null, captions: null, music: { path: 'platformSound' } },
    tracks: [{ kind: 'video', id: 'V1', name: 'Video', enabled: true, items }],
    ...{ styleId: null, voiceover: null, mix: DEFAULT_MIX, createdAt: 1, updatedAt: 1 },
  });
}

/** A library that keeps each take it was given, by its file name. */
function memorySink() {
  const takes = new Map<string, string>();
  const sink: GeneratedAssetSink = {
    put: async (input) => {
      const assetId = newId<'Asset'>();
      takes.set(assetId, input.fileName.replace(/^sfx-bank-/, '').replace(/\.[a-z0-9]+$/, ''));
      return ok({ assetId, contentHash: 'b'.repeat(64), duplicate: false });
    },
  };
  return { sink, takes };
}

const templatesOf = (...stored: Template[]) =>
  ({
    get: async (id: string, version?: number) => {
      const found = stored.find((t) => t.id === id && (version === undefined || t.version === version));
      return found
        ? ok({ summary: {}, schemaVersion: 1, json: found })
        : err(NotFoundError({ entity: 'template', id }));
    },
  }) as unknown as Pick<TemplateStore, 'get'>;

/** Each hit's loudest moment on the timeline, ms, with its take's family. */
function apexes(bank: SfxBank, hits: readonly { assetId: AssetId }[], takes: Map<string, string>) {
  const byFile = new Map<string, SfxBankTake>(
    bank.items.flatMap((item) => item.takes.map((t) => [t.file.replace(/\.flac$/, ''), t])),
  );
  return hits.map((hit) => {
    const placed = hit as unknown as { at: RationalTime; sourceStart: RationalTime; category: SfxCategory };
    const take = byFile.get(takes.get(hit.assetId)!)!;
    const anchor = bank.catalogue.padMs + take.apexMs;
    const ms =
      (RationalTime.toSeconds(placed.at) - RationalTime.toSeconds(placed.sourceStart)) * 1000 + anchor;
    return { ms, family: placed.category, take: take.file };
  });
}

const BANK = join(root, 'bank');
writeBank(BANK);
const template = reelTemplate();
const effects = template.audio.listening!.sfxAtCuts;
const startMs = (slot: number) => RationalTime.toSeconds(template.slots[slot]!.start) * 1000;

describe('the reel’s effects for sfx.addHits fromTemplate (EAR1-G1)', () => {
  it('puts each of the template’s effects on the same cut, its loudest moment where the reel’s was', async () => {
    expect(effects.length).toBeGreaterThanOrEqual(3);
    const timeline = madeTimeline(template);
    const { sink, takes } = memorySink();
    const hits = reelTemplateHits({
      templates: templatesOf(template),
      bank: sfxBankSource(() => BANK),
      sink,
    });
    const payload = unwrap(await hits(timeline, new AbortController().signal));
    expect(payload).toMatchObject({ projectId: timeline.projectId, timelineId: timeline.id, revision: 3 });
    const bank = unwrap(await loadSfxBank(BANK));
    const placed = apexes(bank, payload.hits, takes);
    expect(placed).toHaveLength(effects.length);
    for (const effect of effects) {
      // The effect was on slot cutIndex's cut: the video's cut cutIndex − 1, where that slot's clip starts.
      const want = startMs(effect.cutIndex) + effect.offsetMs;
      const hit = placed.find((p) => Math.abs(p.ms - want) <= 1);
      expect(hit, `slot ${effect.cutIndex}`).toMatchObject({ family: effect.family });
      expect(hit?.take.startsWith(effect.family)).toBe(true);
    }
  });

  it('says why when nothing can go on, before reading the bank', async () => {
    const signal = new AbortController().signal;
    const unread = sfxBankSource(() => {
      throw new Error('the bank was read');
    });
    const reason = async (deps: { stored: Template[]; timeline: Timeline }) => {
      const hits = reelTemplateHits({
        templates: templatesOf(...deps.stored),
        bank: unread,
        sink: memorySink().sink,
      });
      const made = await hits(deps.timeline, signal);
      return made.ok ? 'placed' : [made.error.code, made.error.params?.['reason'] ?? null];
    };
    const timeline = madeTimeline(template);
    const unheard = { ...template, audio: { ...template.audio, listening: undefined } };
    const quiet = {
      ...template,
      audio: { ...template.audio, listening: { ...template.audio.listening!, sfxAtCuts: [] } },
    };
    expect(await reason({ stored: [template], timeline: { ...timeline, template: null } })).toEqual([
      'audio.reel_sfx_unavailable',
      'no_template',
    ]);
    expect(await reason({ stored: [], timeline })).toEqual(['timeline.template_not_found', null]);
    expect(await reason({ stored: [unheard], timeline })).toEqual([
      'audio.reel_sfx_unavailable',
      'no_effects',
    ]);
    expect(await reason({ stored: [quiet], timeline })).toEqual(['audio.reel_sfx_unavailable', 'no_effects']);
    // A shot taken out since: the video has one cut fewer than the template.
    const fewer = madeTimeline(template, template.slots.slice(0, -1));
    expect(await reason({ stored: [template], timeline: fewer })).toEqual([
      'audio.reel_sfx_unavailable',
      'cuts_changed',
    ]);
    const missing = reelTemplateHits({
      templates: templatesOf(template),
      bank: sfxBankSource(() => null),
      sink: memorySink().sink,
    });
    const made = await missing(timeline, signal);
    expect(made.ok ? null : made.error.code).toBe('audio.sfx_bank_missing');
  });

  it('runs through the agent’s sfx.addHits on the installed sfx-bank component and dispatches sfx.setHits', async () => {
    const config = testConfig('agent', ':memory:', join(root, 'user-data'));
    const components = join(config.userData, 'components');
    writeBank(join(components, 'installed', 'sfx-bank', 'test'));
    const entry = {
      ...{ id: 'sfx-bank', version: 'test', sha256: 'c'.repeat(64), platform: 'any' },
      ...{
        dir: 'installed/sfx-bank/test',
        bytes: 1,
        installedAt: '2026-11-07T00:00:00.000Z',
        notice: 'NOTICE.txt',
      },
      licence: {
        spdx: 'MIT',
        notice: { url: 'https://example.com/NOTICE.txt', size: 1, sha256: 'd'.repeat(64) },
      },
    };
    writeFileSync(
      join(components, 'registry.json'),
      JSON.stringify({ schemaVersion: 1, components: { 'sfx-bank': entry } }),
    );
    const { container } = testAgent(config);
    open.push(container);
    const timeline = madeTimeline(template);
    const { sink } = memorySink();
    container
      .value(TimelineStoreToken, {
        get: async () => ok({ summary: {}, schemaVersion: TIMELINE_SCHEMA_VERSION, json: timeline }),
      } as unknown as TimelineStore)
      .value(TemplateStoreToken, templatesOf(template) as TemplateStore)
      .value(GeneratedAssetSinkToken, sink);
    const registry = unwrap(createToolRegistry(withAudioTools(container, [])));
    const addHits = registry.resolve('sfx.addHits')!.spec;
    const dispatched: { hits: unknown[] }[] = [];
    const context = {
      signal: new AbortController().signal,
      callId: newId<'ToolRun'>(),
      attempt: 1,
      reportUsage: () => undefined,
      reportProgress: () => undefined,
      dispatch: async (payload: { hits: unknown[] }) => {
        dispatched.push(payload);
        return ok({ timelineId: timeline.id, revision: timeline.revision + 1 });
      },
    } as unknown as ToolContextBase;
    const input = addHits.input.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      fromTemplate: true,
    });
    expect(await addHits.run(input, context)).toEqual(ok({ hits: effects.length }));
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ timelineId: timeline.id, revision: timeline.revision });
    expect(dispatched[0]?.hits).toHaveLength(effects.length);
  });
});
