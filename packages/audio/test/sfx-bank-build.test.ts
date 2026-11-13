// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-D1: the `sfx-bank` build (tools/audio-packs/sfx-bank). Its catalogue step refuses any item without a licence
 * and a source (and an id or category it can't place), and withholds a sound with no clean take. On the bank this
 * machine built: every shipped take passes the audit again, here in TypeScript (F6's `auditSound`, the role or
 * category it was audited with), its decoded samples measure what the catalogue says (earshot's onset, loudest
 * 5 ms and end, F6's `takeTimes`; momentary-max loudness), the archive is at most 60 MB, and the pack step run
 * twice on the render writes the same sha256. The bank parts skip where the bank (or FFmpeg) isn't there.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SFX_CATEGORIES } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { auditSound } from '../src/listen/dsp/audit';
import { momentaryMaxLufs } from '../src/listen/dsp/audit-detectors';
import { takeTimes } from '../src/listen/dsp/audit-shape';
import { createSpectrogramRunner } from '../src/listen/dsp/spectrogram-graph';
import { apexSeconds } from '../src/sfx/bank-apex';
import { testMedia } from './helpers/ffmpeg';
import { decodeTake, HAS_BANK, INSTALLED_BANK, installedBank, meanMono } from './sfx-bank-helpers';

const BUILD = join(import.meta.dirname, '..', '..', '..', 'tools', 'audio-packs', 'sfx-bank');
const load = async <T>(name: string) => (await import(pathToFileURL(join(BUILD, name)).href)) as T;

interface Row {
  id: string;
  category: string;
  member: string;
  bank_file: string;
  kinds?: string[];
  source?: Record<string, string>;
}
interface Catalogue {
  items: { id: string; licence: string; sourceUrl: string; credit: string | null }[];
  withheld: { id: string; warnings: string[] }[];
}
const { bankCatalogue } = await load<{
  bankCatalogue(render: unknown, options: { packVersion: string; padMs?: number }): { catalogue: Catalogue };
}>('catalogue.mjs');
const { FAMILIES, FAMILY_OF } = await load<{ FAMILIES: string[]; FAMILY_OF: Record<string, string> }>(
  'families.mjs',
);

const take = (sound: string, file: string, ok = true) => ({
  file,
  sound,
  seed: 1,
  planned_seed: 1,
  pitch: null,
  edits: {},
  max_s: null,
  width: null,
  bits: 16,
  channels: 1,
  frames: 4800,
  sha256: 'b'.repeat(64),
  audit: ok
    ? { ok: true, warnings: [], notes: [] }
    : { ok: false, warnings: [{ code: 'rising_glide', msg: 'climbs' }], notes: [] },
  apex_s: 0.01,
  onset_s: 0.001,
  peak_s: 0.0105,
  end_s: 0.09,
  dur_s: 0.1,
  peak_db: -1,
  lufs_m_max: -20,
});
const render = (sounds: Row[], takes = sounds.map((s) => take(s.id, s.id.replaceAll('/', '.')))) => ({
  upstream: { version: '0.4.0', bank: 'forge_v2r6' },
  sr: 48_000,
  sounds: sounds.map((s) => ({ kinds: [], notes: '', knobs: {}, ...s })),
  takes,
});
const whoosh: Row = {
  id: 'whoosh_fast/crisp',
  category: 'whoosh_fast',
  member: 'crisp',
  bank_file: 'forge_v2',
};
const fit: Row = {
  id: 'fit/tick/domino',
  category: 'fit',
  member: 'tick/domino',
  bank_file: 'fit',
  source: {
    title: 'Domino pieces hit',
    author: 'Macif',
    license: 'CC0 1.0',
    url: 'https://freesound.org/s/329098/',
  },
};
const refusal = (sounds: Row[]) => {
  try {
    bankCatalogue(render(sounds), { packVersion: 't' });
    return 'built';
  } catch (e) {
    return (e as Error).message;
  }
};

describe('the sfx-bank build’s catalogue (EAR1-D1)', () => {
  it('maps every bank category onto core’s four families', () => {
    expect(FAMILIES).toEqual([...SFX_CATEGORIES]);
    expect(new Set(Object.values(FAMILY_OF))).toEqual(new Set(SFX_CATEGORIES));
  });

  it('licenses every sound MIT, a fitted one with its CC0 recording as a credit (D22)', () => {
    const { catalogue } = bankCatalogue(render([whoosh, fit]), { packVersion: 't' });
    const bankFile = (name: string) =>
      `https://github.com/Leonxlnx/earshot/blob/ff41f0788ae56896fd59879ab03858d223c06a53/earshot/forge/bank/${name}.json`;
    expect(catalogue.items.map((i) => [i.id, i.licence, i.sourceUrl, i.credit])).toEqual([
      [
        'fit/tick_domino',
        'MIT',
        bankFile('fit'),
        'Fitted to the recording "Domino pieces hit" by Macif (CC0 1.0), https://freesound.org/s/329098/',
      ],
      ['whoosh_fast/crisp', 'MIT', bankFile('forge_v2'), null],
    ]);
  });

  it('refuses any item without a licence or a source, or that it can’t place, naming each', () => {
    expect(refusal([{ ...whoosh, bank_file: 'someone_elses' }])).toMatch(
      /whoosh_fast\/crisp: bank file .* no licence/,
    );
    expect(refusal([{ ...fit, source: undefined } as Row])).toMatch(
      /fit\/tick\/domino: no source recording url/,
    );
    expect(refusal([{ ...fit, source: { ...fit.source, license: 'CC BY 4.0' } }])).toMatch(/is not CC0/);
    expect(refusal([{ ...fit, source: { ...fit.source, author: '' } }])).toMatch(
      /no source title or recordist/,
    );
    expect(refusal([{ ...whoosh, id: 'boing/x', category: 'boing' }])).toMatch(
      /category boing has no family/,
    );
    expect(refusal([{ ...whoosh, id: 'whoosh_fast/a/b/c' }])).toMatch(/not a bank sound id/);
    // Every problem is named, not only the first.
    const both = refusal([{ ...whoosh, bank_file: 'x' }, { ...fit, source: undefined } as Row]);
    expect(both).toMatch(/whoosh_fast\/crisp/);
    expect(both).toMatch(/fit\/tick\/domino/);
  });

  it('ships clean takes only, and withholds a sound with none', () => {
    const takes = [take(whoosh.id, 'w1'), take(whoosh.id, 'w2', false), take(fit.id, 'f1', false)];
    const { catalogue } = bankCatalogue(render([whoosh, fit], takes), { packVersion: 't' });
    expect(catalogue.items.map((i) => i.id)).toEqual(['whoosh_fast/crisp']);
    expect(catalogue.withheld).toEqual([
      { id: 'fit/tick_domino', upstreamId: 'fit/tick/domino', warnings: ['rising_glide'] },
    ]);
  });
});

const found = await testMedia('sfx bank build');
const runner = createSpectrogramRunner();
afterAll(() => runner.release());

describe.skipIf(!HAS_BANK || !found.ctx)('the built sfx-bank (EAR1-D1)', () => {
  it('passes the audit, take by take, and measures as catalogued', { timeout: 600_000 }, async () => {
    const media = found.ctx;
    if (!media) return;
    const bank = await installedBank();
    const pad = (bank.catalogue.padMs * 48_000) / 1000;
    const failed: string[] = [];
    let worstMs = 0;
    let worstLufs = 0;
    for (const item of bank.items)
      for (const t of item.takes) {
        const decoded = await decodeTake(media, bank.pathOf(t), t.channels);
        const channels = decoded.map((c) => c.subarray(pad, c.length - pad));
        expect(channels[0]?.length, t.file).toBe(t.frames);
        const audit = await auditSound({ sampleRate: 48_000, channels }, runner, {
          category: item.category,
          ...(t.auditRole ? { role: t.auditRole } : {}),
        });
        if (!audit.ok) failed.push(`${t.file}: ${audit.warnings.map((w) => w.code).join(', ')}`);
        const mono = meanMono(channels);
        const times = takeTimes(mono);
        const apex = apexSeconds(mono) * 1000;
        for (const [ours, theirs] of [
          [times.onsetS * 1000, t.onsetMs],
          [times.peakS * 1000, t.peakMs],
          [times.endS * 1000, t.endMs],
          [apex, t.apexMs],
        ] as const)
          worstMs = Math.max(worstMs, Math.abs(ours - theirs));
        // polish.lufs_max sums the channels the take has (a mono take is one).
        worstLufs = Math.max(worstLufs, Math.abs(momentaryMaxLufs(channels) - t.loudnessLufs));
      }
    console.warn(`sfx-bank: worst time ${worstMs.toFixed(3)} ms, worst loudness ${worstLufs.toFixed(3)} LU`);
    expect(failed).toEqual([]);
    expect(worstMs).toBeLessThanOrEqual(0.06);
    expect(worstLufs).toBeLessThanOrEqual(0.01);
  });

  it('packs to at most 60 MB', () => {
    const archive = join(INSTALLED_BANK, '..', `sfx-bank-${bankVersion()}.tar.zst`);
    if (!existsSync(archive)) return;
    expect(readFileSync(archive).length).toBeLessThanOrEqual(60 * 1024 * 1024);
  });
});

function bankVersion(): string {
  return (JSON.parse(readFileSync(join(INSTALLED_BANK, 'catalogue.json'), 'utf8')) as { packVersion: string })
    .packVersion;
}

const WORK =
  process.env.TAALCUT_SFX_BANK_WORK ??
  join(process.env.HOME ?? '', '.cache', 'taalcut-ear1', 'sfx-bank-work');
describe.skipIf(!existsSync(join(WORK, 'render.json')) || !found.ctx)(
  'the sfx-bank pack step (EAR1-D1)',
  () => {
    it('writes the same archive twice', { timeout: 300_000 }, async () => {
      const ffmpeg = found.ctx?.binaries.ffmpeg;
      if (!ffmpeg) return;
      const { buildSfxBank } = await load<{
        buildSfxBank(o: { work: string; out: string; ffmpeg: string }): { files: string[] };
      }>('build-sfx-bank.mjs');
      const { writeArchive } = await load<{
        writeArchive(dir: string, names: readonly string[], path: string): { sha256: string; size: number };
      }>('../pack-archive.mjs');
      const scratch = await mkdtemp(join(tmpdir(), 'taalcut-sfx-bank-build-'));
      try {
        const shas = [0, 1].map((i) => {
          const out = join(scratch, `bank-${i}`);
          const { files } = buildSfxBank({ work: WORK, out, ffmpeg });
          const archive = writeArchive(out, files, join(scratch, `bank-${i}.tar.zst`));
          expect(archive.size).toBeLessThanOrEqual(60 * 1024 * 1024);
          return archive.sha256;
        });
        expect(shas[0]).toBe(shas[1]);
        const catalogue = readFileSync(join(scratch, 'bank-0', 'catalogue.json'));
        expect(createHash('sha256').update(catalogue).digest('hex')).toBe(
          createHash('sha256')
            .update(readFileSync(join(scratch, 'bank-1', 'catalogue.json')))
            .digest('hex'),
        );
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    });
  },
);
