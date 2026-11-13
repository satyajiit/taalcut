// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-D2: the `sfx-bank` catalogue and its loader. A valid bank loads, lists and filters; whatever the build must
 * not have shipped (a take that failed the audit, a fitted sound without its credit, a code-made one called CC0,
 * an embedding file that doesn't fit) is `audio.sfx_bank_missing`; the source reads a folder once and finds a bank
 * installed later.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSfxBank, sfxBankSource } from '../src/sfx/bank-source';
import { bankCatalogue, bankItem, bankTake, fitItem, writeCatalogue } from './sfx-bank-helpers';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-sfx-bank-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const riser = bankItem({
  id: 'riser/dark',
  upstreamId: 'riser/dark',
  category: 'riser',
  member: 'dark',
  title: 'Riser, dark',
  family: 'riser',
  kinds: ['riser'],
  source: 'forge04',
  takes: [bankTake({ file: 'riser.dark_s1.flac', apexMs: 640.5, durationMs: 800, endMs: 799 })],
});

async function codeOf(catalogue: unknown): Promise<string> {
  await writeCatalogue(dir, catalogue);
  const loaded = await loadSfxBank(dir);
  return loaded.ok ? 'ok' : loaded.error.code;
}

describe('the SFX bank catalogue (EAR1-D2)', () => {
  it('loads, finds by Taalcut or earshot id, and filters by family, kind, source, licence and id', async () => {
    await writeCatalogue(dir, bankCatalogue([bankItem(), fitItem(), riser]));
    const loaded = await loadSfxBank(dir);
    if (!loaded.ok) throw new Error(loaded.error.detail);
    const bank = loaded.value;
    expect(bank.items.map((i) => i.id)).toEqual(['whoosh_fast/crisp', 'fit/tick_domino', 'riser/dark']);
    expect(bank.byUpstreamId('fit/tick/domino')?.id).toBe('fit/tick_domino');
    expect(bank.byUpstreamId('riser/dark')?.id).toBe('riser/dark');
    expect(bank.item('nope/none')).toBeUndefined();
    expect(bank.filter({ family: 'whoosh' }).map((i) => i.id)).toEqual(['whoosh_fast/crisp']);
    expect(bank.filter({ kind: 'whoosh' }).map((i) => i.id)).toEqual(['whoosh_fast/crisp']);
    expect(bank.filter({ kind: 'whoosh.long' })).toEqual([]);
    // D22: every bank sound is a code-made render, a fitted one too.
    expect(bank.filter({ licence: 'MIT' })).toHaveLength(3);
    expect(bank.filter({ licence: 'CC0-1.0' })).toEqual([]);
    expect(bank.filter({ source: 'forge04', family: 'riser' }).map((i) => i.id)).toEqual(['riser/dark']);
    expect(bank.filter({ ids: ['riser/dark', 'fit/tick_domino'] })).toHaveLength(2);
    expect(bank.filter({})).toHaveLength(3);
    const take = riser.takes[0];
    if (take) expect(bank.pathOf(take)).toBe(join(dir, 'riser.dark_s1.flac'));
  });

  it('refuses what the build may not ship', async () => {
    expect(await codeOf('{ nope')).toBe('audio.sfx_bank_missing');
    expect(await codeOf(bankCatalogue([]))).toBe('audio.sfx_bank_missing');
    const failed = bankTake({
      audit: { ok: false, findings: [{ kind: 'rising_glide', severity: 'warning', detail: 'climbs 20 st' }] },
    });
    const refused = [
      bankItem({ takes: [failed] }),
      fitItem({ credit: null }),
      fitItem({ licence: 'CC0-1.0' }),
      bankItem({ licence: 'CC0-1.0' }),
      bankItem({ credit: 'a recording' }),
      bankItem({ id: 'fit/tick/domino' }),
      bankItem({ takes: [bankTake({ file: '../escape.flac' })] }),
      bankItem({ takes: [bankTake({ apexMs: 900 })] }),
    ];
    for (const item of refused)
      expect(await codeOf(bankCatalogue([item])), JSON.stringify(item)).toBe('audio.sfx_bank_missing');
    expect(await codeOf(bankCatalogue([bankItem(), bankItem()]))).toBe('audio.sfx_bank_missing');
    // A note is information: a take with only notes ships.
    const noted = bankTake({
      audit: { ok: true, findings: [{ kind: 'truncated_tail', severity: 'note', detail: 'stop' }] },
    });
    expect(await codeOf(bankCatalogue([bankItem({ takes: [noted] })]))).toBe('ok');
  });

  it('reads the CLAP embeddings row by row, and refuses a file of the wrong size', async () => {
    const rows = new Float32Array(2 * 512).map((_, i) => (i % 512 === 0 ? 1 : 0));
    const set = {
      model: 'clap-general-audio',
      dtype: 'int8',
      file: 'embeddings-int8.f32',
      dims: 512,
      rows: 2,
    } as const;
    await writeCatalogue(dir, bankCatalogue([bankItem(), riser], { embeddings: [set] }));
    await writeFile(join(dir, set.file), Buffer.from(rows.buffer));
    const loaded = await loadSfxBank(dir);
    if (!loaded.ok) throw new Error(loaded.error.detail);
    expect(loaded.value.embeddingDtypes()).toEqual(['int8']);
    const read = await loaded.value.embeddings('int8');
    if (!read.ok) throw new Error(read.error.detail);
    expect(read.value.rows).toEqual(rows);
    expect((await loaded.value.embeddings('fp16')).ok).toBe(false);
    await writeFile(join(dir, set.file), Buffer.alloc(12));
    const short = await loadSfxBank(dir);
    expect(short.ok && (await short.value.embeddings('int8')).ok).toBe(false);
    expect(await codeOf(bankCatalogue([bankItem()], { embeddings: [set] }))).toBe('audio.sfx_bank_missing');
  });

  it('reads an installed folder once, and finds a bank installed later', async () => {
    let installed: string | null = null;
    const source = sfxBankSource(() => installed);
    const before = await source.load();
    expect(before.ok ? 'ok' : before.error.code).toBe('audio.sfx_bank_missing');
    await writeCatalogue(dir, bankCatalogue([bankItem()]));
    installed = dir;
    const first = await source.load();
    await writeCatalogue(dir, '{ changed but not re-read');
    const second = await source.load();
    expect(first.ok && second.ok && first.value === second.value).toBe(true);
  });
});
