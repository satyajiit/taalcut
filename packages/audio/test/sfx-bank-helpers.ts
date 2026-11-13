// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shared by the EAR1-D tests: a small valid `sfx-bank` catalogue to edit, the installed bank when this machine has
 * built it (tools/audio-packs/sfx-bank: `packages/audio/.cache/packs/sfx-bank`, or `TAALCUT_SFX_BANK`), a take's
 * audio decoded as earshot reads it, and earshot's take times on it.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaContext } from '@taalcut/media';
import type { SfxBankCatalogue, SfxBankItem, SfxBankTake } from '../src/sfx/bank-catalogue';
import { loadSfxBank, type SfxBank } from '../src/sfx/bank-source';
import { decodeAudioFile } from '../src/pcm/decode';

export const bankTake = (overrides: Partial<SfxBankTake> = {}): SfxBankTake => ({
  file: 'whoosh_fast.crisp_s7.flac',
  seed: 7,
  plannedSeed: 7,
  auditRole: null,
  pitch: null,
  width: null,
  bits: 16,
  channels: 2,
  frames: 24_000,
  durationMs: 500,
  onsetMs: 12.5,
  apexMs: 210.5,
  peakMs: 210.5,
  endMs: 480,
  peakDb: -1,
  loudnessLufs: -14.2,
  pcmSha256: 'a'.repeat(64),
  audit: { ok: true, findings: [] },
  ...overrides,
});

export const bankItem = (overrides: Partial<SfxBankItem> = {}): SfxBankItem => ({
  id: 'whoosh_fast/crisp',
  upstreamId: 'whoosh_fast/crisp',
  category: 'whoosh_fast',
  member: 'crisp',
  seed: 7,
  title: 'Whoosh fast, crisp',
  family: 'whoosh',
  kinds: ['whoosh.short', 'suck'],
  source: 'forge_v2',
  licence: 'MIT',
  sourceUrl:
    'https://github.com/Leonxlnx/earshot/blob/ff41f0788ae56896fd59879ab03858d223c06a53/earshot/forge/bank/forge_v2.json',
  credit: null,
  provenance: "Rendered from earshot's forge v2 recipe code (MIT); no recording used.",
  notes: 'whip pans, fast fly-ins, element moves',
  knobs: { dur: 'shape', apex: true, pitch: null },
  takes: [bankTake()],
  ...overrides,
});

export const fitItem = (overrides: Partial<SfxBankItem> = {}): SfxBankItem =>
  bankItem({
    id: 'fit/tick_domino',
    upstreamId: 'fit/tick/domino',
    category: 'fit',
    member: 'tick/domino',
    title: 'Tick domino (fitted from "Domino pieces hit")',
    family: 'hit',
    kinds: ['tick'],
    source: 'fit',
    licence: 'MIT',
    sourceUrl:
      'https://github.com/Leonxlnx/earshot/blob/ff41f0788ae56896fd59879ab03858d223c06a53/earshot/forge/bank/fit.json',
    credit:
      'Fitted to the recording "Domino pieces hit" by Macif (CC0 1.0), https://freesound.org/people/Macif/sounds/329098/',
    provenance:
      "Rendered by earshot's code from a fitted model in fit.json (MIT); no samples of the recording ship.",
    knobs: { dur: 'trim', apex: false, pitch: null },
    takes: [
      bankTake({ file: 'fit.tick.domino_s0.flac', seed: 0, plannedSeed: 0, apexMs: 7.5, onsetMs: 4.2 }),
    ],
    ...overrides,
  });

export const bankCatalogue = (
  items: readonly SfxBankItem[],
  overrides: Partial<SfxBankCatalogue> = {},
): SfxBankCatalogue => ({
  version: 1,
  pack: 'sfx-bank',
  packVersion: '0.4.0-ff41f07.1',
  upstream: {
    repository: 'https://github.com/Leonxlnx/earshot',
    commit: 'ff41f0788ae56896fd59879ab03858d223c06a53',
    version: '0.4.0',
    bank: 'forge_v2r6+forge04r1+fit1+pluck1',
  },
  sampleRate: 48_000,
  padMs: 50,
  items: [...items],
  withheld: [],
  embeddings: [],
  ...overrides,
});

export const writeCatalogue = (dir: string, catalogue: unknown) =>
  writeFile(
    join(dir, 'catalogue.json'),
    typeof catalogue === 'string' ? catalogue : JSON.stringify(catalogue),
  );

/** The bank this machine built, if it did. */
export const INSTALLED_BANK =
  process.env.TAALCUT_SFX_BANK ?? join(import.meta.dirname, '..', '.cache', 'packs', 'sfx-bank');
export const HAS_BANK = existsSync(join(INSTALLED_BANK, 'catalogue.json'));

export async function installedBank(): Promise<SfxBank> {
  const loaded = await loadSfxBank(INSTALLED_BANK);
  if (!loaded.ok) throw new Error(`${loaded.error.code}: ${loaded.error.detail ?? ''}`);
  return loaded.value;
}

/** A take's file decoded at 48 kHz with its own channels (pads included). */
export async function decodeTake(
  media: MediaContext,
  path: string,
  channels: 1 | 2 = 2,
): Promise<Float32Array[]> {
  const pcm = await decodeAudioFile(path, media, { sampleRate: 48_000, channels });
  if (!pcm.ok) throw new Error(pcm.error.code);
  return [...pcm.value.channels];
}

/** earshot's `_mono`: the channels' mean, in float64. */
export function meanMono(channels: readonly Float32Array[]): Float64Array {
  const [a, b] = channels;
  const out = new Float64Array(a?.length ?? 0);
  for (let i = 0; i < out.length; i++) out[i] = b ? ((a?.[i] ?? 0) + (b[i] ?? 0)) / 2 : (a?.[i] ?? 0);
  return out;
}
