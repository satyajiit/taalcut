// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-B1 end to end on fp16 (WebGPU first) against upstream's `earshot find` runs on the 11 long parity clips: F2's
 * 10 runs (tools/earshot-parity) and 16 more on films 01 and 03–09 (fixtures/find-runs.json, made by find-runs.py
 * in upstream's venv on F2's clips). The query's kind must be the same, and each of upstream's top 3 moments matched
 * by one of ours (start within ±0.5 s), or tied: ours ranks it lower only because fp16's drift (D23) reorders
 * scores within 0.05 z of our third. Prints the per-run numbers for the SPEC.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cli, clip, clipWavBytes } from '../../../../tools/earshot-parity/fixtures.mjs';
import { createListenModels, type ListenSource } from '../../src/listen/describe/context';
import { findMoments, type FindKind } from '../../src/listen/describe/find';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { directoryListenFiles } from '../../src/listen/models/files';
import { createListenSessions } from '../../src/listen/models/sessions';
import { modelMono, MODELS } from './models-helpers';

type Segment = { start: number; end: number; kind: string; z: number; score: number };
type Run = { query_kind: string; segments: Segment[] };
type Runs = Record<string, { argv: string[]; result: Run }>;

const TOLERANCE_S = 0.5;
const TIE_Z = 0.05;

const extra = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'find-runs.json'), 'utf8')) as {
  clips: Record<string, string>;
  runs: Runs;
};

function parse(argv: readonly string[]) {
  const [, file = '', query = '', ...flags] = argv;
  const flag = (name: string) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);
  const top = flag('--top');
  return {
    id: file.replace(/\.wav$/, ''),
    query,
    kind: (flag('--kind') ?? 'auto') as FindKind,
    top: top ? Number(top) : 5,
  };
}

describe.skipIf(!MODELS)('find against upstream (fp16)', () => {
  const files = directoryListenFiles(MODELS ?? '', 'fp16');
  const sessions = createListenSessions({ files });
  const models = createListenModels(sessions, files);
  const runner = createSpectrogramRunner();
  afterAll(async () => {
    await sessions.release();
    await runner.release();
  });

  it('the extra runs were made on the clips F2 regenerates', () => {
    for (const [id, sha] of Object.entries(extra.clips))
      expect(createHash('sha256').update(clipWavBytes(id)).digest('hex'), id).toBe(sha);
  });

  it("matches upstream's top 3 starts within ±0.5 s and reads the query's kind the same", async () => {
    const sources = new Map<string, { source: ListenSource; spans: Map<string, Float32Array> }>();
    let matched = 0;
    let tied = 0;
    let total = 0;
    let kindsSame = 0;
    const runs = [...Object.entries(cli<Run>('find')), ...Object.entries(extra.runs)];
    const clipsSeen = new Set<string>();
    for (const [runId, run] of runs) {
      const args = parse(run.argv);
      clipsSeen.add(args.id);
      let entry = sources.get(args.id);
      if (!entry) {
        entry = {
          source: { name: args.id, samples: modelMono(args.id), channels: clip(args.id).channels },
          spans: new Map(),
        };
        sources.set(args.id, entry);
      }
      const ours = await findMoments(models, entry.source, args.query, {
        top: 10,
        kind: args.kind,
        runner,
        spans: entry.spans,
      });
      expect(ours.ok, runId).toBe(true);
      if (!ours.ok) continue;
      if (ours.value.queryKind === run.result.query_kind) kindsSame += 1;
      const theirs = run.result.segments.slice(0, 3);
      const all = ours.value.moments;
      const mine = all.slice(0, Math.min(3, args.top));
      const cutoff = mine.at(-1)?.score ?? -Infinity;
      const near = (s: Segment, list: typeof all) =>
        list.find((m) => Math.abs(m.start - s.start) <= TOLERANCE_S);
      const hits = theirs.filter((s) => near(s, mine)).length;
      const ties = theirs.filter((s) => {
        const lower = near(s, all.slice(3));
        return !near(s, mine) && lower !== undefined && cutoff - lower.score <= TIE_Z;
      }).length;
      matched += hits;
      tied += ties;
      total += theirs.length;
      console.warn(
        `${runId}: ${hits}/${theirs.length}${ties ? ` (+${ties} tied)` : ''}; ` +
          `ours ${mine.map((m) => `${m.start}(${m.kind} ${m.score})`).join(' ')}; ` +
          `theirs ${theirs.map((s) => `${s.start}(${s.kind} ${s.score})`).join(' ')}`,
      );
    }
    console.warn(
      `find: ${runs.length} runs on ${clipsSeen.size} clips; top-3 starts ${matched}/${total} (+${tied} tied within ` +
        `${TIE_Z} z); query kind ${kindsSame}/${runs.length}`,
    );
    expect(clipsSeen.size).toBeGreaterThanOrEqual(10);
    expect(kindsSame).toBe(runs.length);
    expect(matched + tied).toBe(total);
    expect(matched / total).toBeGreaterThanOrEqual(0.9);
  }, 900_000);
});
