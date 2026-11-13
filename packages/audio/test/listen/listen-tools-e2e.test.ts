// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A3 end to end: `audio.compare`'s A/B as the jobs process runs it (the listen service's `ab` query, our CLAP
 * on fp16) on upstream's 10 pairs (tools/earshot-parity cli/ab.json): the terms B differs from A by, in upstream's
 * order, the same; CLAP's cosine within 0.01; the same side closer to the description. Needs TAALCUT_EAR1_MODELS.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, RationalTime, TimeRange } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { cli, writeClip } from '../../../../tools/earshot-parity/fixtures.mjs';
import { createListenService } from '../../src/listen/analysis/service';
import type { AbQueryResult } from '../../src/listen/describe/ab-query';
import { directoryListenFiles } from '../../src/listen/models/files';
import { testMedia } from '../helpers/ffmpeg';
import { MODELS } from './models-helpers';

interface AbRun {
  readonly a_range: readonly [number | null, number | null];
  readonly cosine_ab: number;
  readonly query?: { readonly closer: 'a' | 'b' | null } | null;
  readonly differences: readonly string[];
}

const media = await testMedia('listen tools e2e');
const root = mkdtempSync(join(tmpdir(), 'taalcut-listen-ab-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const ms = (s: number) => RationalTime.fromSeconds(s, { num: 1000, den: 1 });

describe.skipIf(!MODELS || !media.ctx)('audio.compare’s A/B against upstream (fp16)', () => {
  it(
    'the same difference terms, cosine within 0.01 and the same closer side on 10 pairs',
    { timeout: 600_000 },
    async () => {
      const service = createListenService({
        media: async () => ok(media.ctx ?? (undefined as never)),
        files: directoryListenFiles(MODELS ?? '', 'fp16'),
      });
      try {
        let same = 0;
        const runs = Object.entries(cli<AbRun>('ab'));
        for (const [id, run] of runs) {
          const [a, b] = [run.argv[1], run.argv[2]].map((f) => (f ?? '').replace(/\.wav$/, ''));
          const query = run.argv.includes('--query') ? run.argv[run.argv.indexOf('--query') + 1] : undefined;
          const refsAt = run.argv.indexOf('--refs');
          const refs =
            refsAt < 0
              ? []
              : run.argv
                  .slice(refsAt + 1)
                  .filter((x) => x.endsWith('.wav'))
                  .map((f) => f.replace(/\.wav$/, ''));
          const [start, end] = run.result.a_range;
          const aRange =
            start !== null && end !== null ? { range: TimeRange.of(ms(start), ms(end - start)) } : {};
          const sources = [
            { path: writeClip(a ?? '', root), name: 'a', ...aRange },
            { path: writeClip(b ?? '', root), name: 'b' },
            ...refs.map((r) => ({ path: writeClip(r, root), name: r })),
          ];
          const ran = await service.query('ab', sources, query ? { query } : {});
          if (!ran.ok) throw new Error(`${id}: ${ran.error.code}`);
          const result = ran.value as AbQueryResult;
          expect(Math.abs(result.cosineAb - run.result.cosine_ab), id).toBeLessThanOrEqual(0.01);
          if (run.result.query) expect(result.query?.closer, id).toBe(run.result.query.closer);
          if (JSON.stringify(result.differences?.keys ?? []) === JSON.stringify(run.result.differences))
            same += 1;
        }
        expect(same).toBe(10);
      } finally {
        await service.release();
      }
    },
  );
});
