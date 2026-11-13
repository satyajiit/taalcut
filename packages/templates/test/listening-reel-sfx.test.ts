// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C2: a fixture template's effects on its cuts (sfxAtCuts) become one `sfx.setHits` on a video made from it,
 * at the same cuts: each a bank sound of the effect's family, where the reel's effect was (the cut plus the reel's
 * offset: EAR1-R2, the take's onset for an effect heard as an attack, its apex for a swell), naming its cut
 * (EAR1-K3), its take added to the library as a bundled sfx-bank item. On a small bank made here, and on the bank
 * this machine built (tools/audio-packs/sfx-bank) when it has.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  newId,
  ok,
  RationalTime,
  SFX_CATEGORIES,
  type AssetId,
  type GeneratedAssetSink,
  type SfxCategory,
} from '@taalcut/core';
import { loadSfxBank, type SfxBank, type SfxBankTake } from '@taalcut/audio';
import { reelHitRequests, reelSfxPayload } from '../src/index';
import { film, filmTemplate, madeTimeline } from './helpers/listening-film';

const root = mkdtempSync(join(tmpdir(), 'taalcut-reel-sfx-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const INSTALLED =
  process.env.TAALCUT_SFX_BANK ?? join(import.meta.dirname, '../../audio/.cache/packs/sfx-bank');
const FILMS = ['film-00', 'film-01', 'film-03', 'film-08'];
const PAD_MS = 50;

const take = (file: string, apexMs: number, durationMs: number) => ({
  file,
  seed: 1,
  plannedSeed: 1,
  auditRole: null,
  pitch: null,
  width: null,
  bits: 16,
  channels: 2,
  frames: Math.round(durationMs * 48),
  durationMs,
  onsetMs: Math.max(0, apexMs - 2),
  apexMs,
  peakMs: apexMs,
  endMs: durationMs - 5,
  peakDb: -1,
  loudnessLufs: -14,
  pcmSha256: 'a'.repeat(64),
  audit: { ok: true, findings: [] },
});

const SHAPES: Record<SfxCategory, { apex: number; length: number; title: string }> = {
  whoosh: { apex: 210, length: 500, title: 'Whoosh fast, air' },
  riser: { apex: 1480, length: 1500, title: 'Riser, uplifter sweep' },
  impact: { apex: 8, length: 900, title: 'Impact, deep boom' },
  hit: { apex: 4, length: 250, title: 'Hit, soft tap' },
};

/** A bank of two sounds a family, two takes each, as audio's loader reads it. */
async function smallBank(): Promise<SfxBank> {
  const dir = join(root, 'bank');
  const items = SFX_CATEGORIES.flatMap((family) =>
    ['a', 'b'].map((variant) => {
      const shape = SHAPES[family];
      const takes = [0, 1].map((k) => take(`${family}_${variant}_s${k}.flac`, shape.apex + k, shape.length));
      return {
        id: `${family}_${variant}/plain`,
        upstreamId: `${family}_${variant}/plain`,
        category: `${family}_${variant}`,
        member: 'plain',
        seed: 1,
        title: `${shape.title} ${variant}`,
        family,
        kinds: [family],
        source: 'forge_v2',
        licence: 'MIT',
        sourceUrl: 'https://github.com/Leonxlnx/earshot',
        credit: null,
        provenance: "Rendered from earshot's recipe code (MIT).",
        notes: '',
        knobs: { dur: 'shape', apex: true, pitch: null },
        takes,
      };
    }),
  );
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  for (const item of items)
    for (const t of item.takes) await writeFile(join(dir, t.file), Buffer.from('fLaC'));
  await writeFile(
    join(dir, 'catalogue.json'),
    JSON.stringify({
      version: 1,
      pack: 'sfx-bank',
      packVersion: 'test',
      upstream: {
        repository: 'https://github.com/Leonxlnx/earshot',
        commit: 'ff41f0788ae56896fd59879ab03858d223c06a53',
        version: '0.4.0',
        bank: 'test',
      },
      sampleRate: 48_000,
      padMs: PAD_MS,
      items,
      withheld: [],
      embeddings: [],
    }),
  );
  const loaded = await loadSfxBank(dir);
  if (!loaded.ok) throw new Error(`${loaded.error.code}: ${loaded.error.detail ?? ''}`);
  return loaded.value;
}

/** A library that keeps what it was given: each take's asset, by its file name. */
function memorySink() {
  const takes = new Map<AssetId, string>();
  const sink: GeneratedAssetSink = {
    async put(input) {
      const assetId = newId<'Asset'>() as AssetId;
      takes.set(assetId, input.fileName.replace(/^sfx-bank-/, '').replace(/\.flac$/, ''));
      expect(input.provenance).toMatchObject({ kind: 'bundled', pack: 'sfx-bank' });
      return ok({ assetId });
    },
  } as GeneratedAssetSink;
  return { sink, takes };
}

/** The share of the template's effects that are a hit of their family placed where the reel's was (±1 ms). */
async function placedShare(id: string, bank: SfxBank): Promise<number> {
  const template = filmTemplate(film(id));
  const timeline = madeTimeline(template);
  const effects = template.audio.listening!.sfxAtCuts;
  const requests = reelHitRequests(template, timeline)!;
  const { sink, takes } = memorySink();
  const payload = await reelSfxPayload(template, timeline, { bank, sink });
  if (!payload.ok || !payload.value) throw new Error('no payload');
  expect(payload.value).toMatchObject({ timelineId: timeline.id, revision: timeline.revision });
  const takeOf = new Map(
    bank.items.flatMap((item) => item.takes.map((t) => [t.file.replace(/\.flac$/, ''), t])),
  );
  const placed = payload.value.hits.map((hit) => {
    const t = takeOf.get(takes.get(hit.assetId as AssetId)!) as SfxBankTake;
    const zero =
      RationalTime.toSeconds(hit.at) * 1000 -
      RationalTime.toSeconds(hit.sourceStart) * 1000 +
      bank.catalogue.padMs;
    const cutMs = hit.cut ? RationalTime.toSeconds(hit.cut) * 1000 : null;
    const at = { onset: zero + t.onsetMs, apex: zero + t.apexMs };
    // EAR1-R2: no overlap is resolved by trimming a sound before its apex.
    const start = RationalTime.toSeconds(hit.at) * 1000;
    expect(at.apex).toBeGreaterThanOrEqual(start - 0.5);
    expect(at.apex).toBeLessThan(start + RationalTime.toSeconds(hit.duration) * 1000);
    return { at, cutMs, family: hit.category, soundFamily: bank.item(hit.soundId!)?.family };
  });
  const landed = effects.filter((effect) => {
    const request = requests.find((r) => r.slotIndex === effect.cutIndex);
    if (!request) return false;
    const want = request.cutMs + effect.offsetMs;
    return placed.some(
      (hit) =>
        hit.family === effect.family &&
        hit.soundFamily === effect.family &&
        hit.cutMs !== null &&
        Math.abs(hit.cutMs - request.cutMs) <= 0.5 &&
        Math.abs(hit.at[request.align] - want) <= 1,
    );
  });
  return landed.length / effects.length;
}

describe('reelSfxPayload (EAR1-C2)', () => {
  it.each(FILMS)('%s: ≥ 90% of its effects become sfx.setHits at the same cuts', async (id) => {
    const share = await placedShare(id, await smallBank());
    expect(share).toBeGreaterThanOrEqual(0.9);
  });

  it('aligns an effect heard as an attack by the take’s onset, a swell by its apex (EAR1-R2)', () => {
    const aligns = new Set(
      FILMS.flatMap((id) => {
        const template = filmTemplate(film(id));
        return (reelHitRequests(template, madeTimeline(template)) ?? []).map((r) => `${r.family}:${r.align}`);
      }),
    );
    expect([...aligns].sort()).toEqual(expect.arrayContaining(['hit:onset', 'riser:apex']));
  });

  it('gives no payload for a video with other cuts', async () => {
    const template = filmTemplate(film('film-00'));
    const timeline = madeTimeline({ ...template, slots: template.slots.slice(0, -1) });
    const made = await reelSfxPayload(template, timeline, {
      bank: await smallBank(),
      sink: memorySink().sink,
    });
    expect(made).toEqual(ok(null));
  });

  it.skipIf(!existsSync(join(INSTALLED, 'catalogue.json')))(
    'on the bank this machine built: ≥ 90% of each film’s effects at the same cuts',
    async () => {
      const loaded = await loadSfxBank(INSTALLED);
      if (!loaded.ok) throw new Error(loaded.error.code);
      for (const id of FILMS) {
        const share = await placedShare(id, loaded.value);
        console.warn(`[EAR1-C2] ${id}: ${(share * 100).toFixed(1)}% of effects placed on the installed bank`);
        expect(share).toBeGreaterThanOrEqual(0.9);
      }
    },
  );
});
