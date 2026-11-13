// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F4's budget: 6 CLAP windows and 6 AST windows in ≤ 1.5 s warm, front ends and the 16 kHz resample included.
 * A 35.84 s source is exactly 6 of each. The plan's bench is an M1; this records the Mac it runs on. The gate is the
 * best of 5 runs: other test files on the same GPU (or other work on a shared Mac) only add time, so the median is
 * reported beside it. Run this file alone for the number to record. Needs `TAALCUT_EAR1_MODELS` and the fp16 builds.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createAstTagger } from '../../src/listen/models/ast';
import { createClapAudio } from '../../src/listen/models/clap-audio';
import { directoryListenFiles } from '../../src/listen/models/files';
import { createListenSessions } from '../../src/listen/models/sessions';
import { clapSpans } from '../../src/listen/models/windows';
import { modelMono, MODELS } from './models-helpers';

const BUDGET_MS = 1500;

describe.skipIf(!MODELS)('listening budget', () => {
  const sessions = createListenSessions({ files: directoryListenFiles(MODELS ?? '', 'fp16') });
  afterAll(() => sessions.release());

  it('6 CLAP windows and 6 AST windows within 1.5 s warm', async () => {
    const clap = createClapAudio(sessions);
    const ast = createAstTagger(sessions);
    const source = modelMono('film-00').subarray(0, Math.round(35.84 * 48_000));
    expect(clapSpans(0, source.length / 48_000)).toHaveLength(6);
    await clap.embedSegments([source.subarray(0, 48_000)]);
    await ast.probs([source.subarray(0, 48_000)]);
    const runs: { clap: number; ast: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const embedded = await clap.embedSource(source);
      const t1 = performance.now();
      const tagged = await ast.probs([source]);
      const t2 = performance.now();
      expect(embedded.ok && embedded.value.windows.length).toBe(6);
      expect(tagged.ok && tagged.value[0]?.logits.length).toBe(6);
      runs.push({ clap: t1 - t0, ast: t2 - t1 });
    }
    const totals = runs.map((run) => run.clap + run.ast).sort((a, b) => a - b);
    const median = totals[2] ?? Number.POSITIVE_INFINITY;
    const best = totals[0] ?? Number.POSITIVE_INFINITY;
    console.warn(
      `listen budget (${sessions.backend('clapAudio')}): ${runs
        .map((run) => `CLAP ${run.clap.toFixed(0)} ms + AST ${run.ast.toFixed(0)} ms`)
        .join('; ')}; best ${best.toFixed(0)} ms, median ${median.toFixed(0)} ms`,
    );
    expect(best).toBeLessThanOrEqual(BUDGET_MS);
  }, 300_000);
});
