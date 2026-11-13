// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F5 end to end on fp16 (WebGPU) against upstream's CLI runs: describe (every clip), match, rank, compare and
 * ab. The calibration's own gates are in calibrate-*.test.ts; here the whole path (decode level, windows, both
 * models, the shipped text bank or the text model) is held to: shared tags' z within ±0.15, the same near-silence
 * handling, verdicts the same unless flagged borderline, the same nearest references and the same A/B choice.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { cli, clip, manifest } from '../../../../tools/earshot-parity/fixtures.mjs';
import { abSounds, compareSound } from '../../src/listen/describe/compare';
import { createListenModels, type ListenSource } from '../../src/listen/describe/context';
import { describeSound } from '../../src/listen/describe/describe';
import { matchSound } from '../../src/listen/describe/match';
import { rankSounds } from '../../src/listen/describe/rank';
import { directoryListenFiles } from '../../src/listen/models/files';
import { createListenSessions } from '../../src/listen/models/sessions';
import { modelMono, MODELS } from './models-helpers';

const Z = 0.15;
const VERDICT: Record<string, string> = { 'no match': 'no_match' };
const source = (file: string): ListenSource => {
  const id = file.replace(/\.wav$/, '');
  return { name: file, samples: modelMono(id), channels: clip(id).channels };
};

describe.skipIf(!MODELS)('describe, match, rank and compare end to end (fp16)', () => {
  const files = directoryListenFiles(MODELS ?? '', 'fp16');
  const sessions = createListenSessions({ files });
  const models = createListenModels(sessions, files);
  afterAll(() => sessions.release());

  it('describe: shared tags within ±0.15, near silence the same, the top tag recorded', async () => {
    type Tag = { term: string; z: number; verdict?: string };
    const runs = cli<{ top_tags: Tag[]; audioset: { label: string }[] }>('describe');
    let worst = 0;
    let topSame = 0;
    let astSame = 0;
    let tagged = 0;
    for (const row of manifest().clips) {
      const run = runs[row.id];
      if (!run) continue;
      const ours = await describeSound(models, source(`${row.id}.wav`));
      expect(ours.ok, row.id).toBe(true);
      if (!ours.ok) continue;
      const theirs = run.result.top_tags;
      expect(ours.value.tags.length === 0, row.id).toBe(theirs.length === 0);
      if (theirs.length === 0) continue;
      tagged += 1;
      if (ours.value.tags[0]?.term === theirs[0]?.term) topSame += 1;
      if (ours.value.audioSet[0]?.label === run.result.audioset[0]?.label) astSame += 1;
      for (const tag of theirs) {
        const mine = ours.value.tags.find((t) => t.term === tag.term);
        if (!mine) continue;
        worst = Math.max(worst, Math.abs(mine.z - tag.z));
        if (mine.verdict !== (VERDICT[tag.verdict ?? ''] ?? tag.verdict))
          expect(mine.borderline, tag.term).toBe(true);
      }
    }
    console.warn(
      `describe: ${tagged} tagged clips; top tag ${topSame}/${tagged}, AudioSet top ${astSame}/${tagged}; shared tags max |Δz| ${worst.toFixed(3)}`,
    );
    expect(worst).toBeLessThanOrEqual(Z);
    expect(topSame / tagged).toBeGreaterThanOrEqual(0.9);
  }, 600_000);

  it('match: z within ±0.15, verdicts the same unless borderline, p_vs_alts within 0.05', async () => {
    type Row = { query: string; z: number; verdict: string; p_vs_alts: number | null };
    let worst = 0;
    let worstP = 0;
    for (const [id, run] of Object.entries(cli<{ results: Row[] }>('match'))) {
      const args = run.argv.slice(2);
      const flag = (name: string) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : undefined);
      const positional = args.slice(0, args.findIndex((a) => a.startsWith('--')) >>> 0 || args.length);
      const alt = args.indexOf('--alts');
      const altEnd = args.findIndex((a, i) => i > alt && a.startsWith('--'));
      const alts = alt >= 0 ? args.slice(alt + 1, altEnd > alt ? altEnd : undefined) : [];
      const start = flag('--start');
      const end = flag('--end');
      const range =
        start !== undefined || end !== undefined
          ? { ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) }
          : undefined;
      const ours = await matchSound(models, source(run.argv[1] ?? ''), positional, {
        alts,
        ...(range ? { range } : {}),
      });
      expect(ours.ok, id).toBe(true);
      if (!ours.ok) continue;
      for (const theirs of run.result.results) {
        const mine = ours.value.results.find((r) => r.query === theirs.query);
        if (!mine) throw new Error(`${id}: ${theirs.query} missing`);
        worst = Math.max(worst, Math.abs(mine.z - theirs.z));
        const verdict = VERDICT[theirs.verdict] ?? theirs.verdict;
        if (!mine.hint && mine.verdict !== verdict)
          expect(mine.borderline, `${id}: ${theirs.query}`).toBe(true);
        if (theirs.p_vs_alts !== null)
          worstP = Math.max(worstP, Math.abs((mine.pVsAlts ?? 0) - theirs.p_vs_alts));
      }
    }
    console.warn(`match end to end: max |Δz| ${worst.toFixed(3)}, max |Δp_vs_alts| ${worstP.toFixed(3)}`);
    expect(worst).toBeLessThanOrEqual(Z);
    expect(worstP).toBeLessThanOrEqual(0.05);
  }, 600_000);

  it('rank: the same order wherever upstream’s z differ by more than 0.3', async () => {
    type Row = { name: string; z: number };
    for (const run of Object.values(cli<{ results: Row[] }>('rank'))) {
      const query = run.argv[1] ?? '';
      const names = run.argv.slice(2).filter((a) => a.endsWith('.wav'));
      const ours = await rankSounds(models, names.map(source), query);
      expect(ours.ok).toBe(true);
      if (!ours.ok) continue;
      const theirs = run.result.results;
      const z = new Map(ours.value.results.map((r) => [r.name ?? '', r.z]));
      for (let i = 0; i + 1 < theirs.length; i++) {
        const [a, b] = [theirs[i] as Row, theirs[i + 1] as Row];
        if (a.z - b.z > 0.3)
          expect(z.get(a.name) ?? 0, `${query}: ${a.name} > ${b.name}`).toBeGreaterThan(z.get(b.name) ?? 0);
        expect(Math.abs((z.get(a.name) ?? 0) - a.z)).toBeLessThanOrEqual(Z);
      }
    }
  }, 600_000);

  it('compare and ab: the same nearest references, cosine within 0.01, the same choice', async () => {
    for (const [id, run] of Object.entries(cli<{ nearest: { name: string; cosine: number }[] }>('compare'))) {
      const refsAt = run.argv.indexOf('--refs');
      const refs = run.argv.slice(refsAt + 1).filter((a) => !a.startsWith('-'));
      const ours = await compareSound(models, source(run.argv[1] ?? ''), refs.map(source));
      expect(ours.ok, id).toBe(true);
      if (!ours.ok) continue;
      run.result.nearest.slice(0, 3).forEach((theirs, i) => {
        const mine = ours.value.nearest[i];
        expect(refs[mine?.index ?? -1], id).toBe(theirs.name);
        expect(Math.abs((mine?.cosine ?? 0) - theirs.cosine)).toBeLessThanOrEqual(0.01);
      });
    }
    type Ab = { cosine_ab: number; query: { closer: string | null; dz: number } | null };
    for (const [id, run] of Object.entries(cli<Ab>('ab'))) {
      const [a, b] = run.argv.slice(1, 3);
      const query = run.argv.includes('--query') ? run.argv[run.argv.indexOf('--query') + 1] : undefined;
      if (!a || !b || run.argv.some((x) => x.endsWith('-start') || x.endsWith('-end') || x === '--refs'))
        continue;
      const ours = await abSounds(models, source(a), source(b), query ? { query } : {});
      expect(ours.ok, id).toBe(true);
      if (!ours.ok) continue;
      expect(Math.abs(ours.value.cosineAb - run.result.cosine_ab), id).toBeLessThanOrEqual(0.01);
      if (run.result.query && run.result.query.dz > 0.45)
        expect(ours.value.query?.closer, id).toBe(run.result.query.closer);
    }
  }, 600_000);
});
