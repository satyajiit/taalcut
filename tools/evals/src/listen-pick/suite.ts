// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-pick as a listening suite (EAR1-I3 over EAR1-B2): the 60 golden queries searched over the built SFX bank by
 * predict.ts and scored by run.ts, in one go, the top-5 family rate against its bar. Skipped, with the reason, without
 * the listen models (CLAP audio and text) or a built bank. The per-query report goes beside the suite's.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listenModelsHere } from '../listening/environment';
import { outcomeOf, type ListenOutcome } from '../listening/outcome';
import { pickLabels } from './fixtures';
import { pickEnvironment, predictPick } from './predict';
import { scorePick, writePickReport } from './run';

export async function runPickSuite(outDir: string): Promise<ListenOutcome> {
  const started = performance.now();
  const seconds = () => (performance.now() - started) / 1000;
  const here = await listenModelsHere(['clapAudio', 'clapText']);
  if ('reason' in here)
    return outcomeOf('listen-pick', {
      metrics: [],
      skipped: [{ part: 'queries', reason: here.reason }],
      seconds: seconds(),
    });
  const { bank } = pickEnvironment();
  if (!existsSync(join(bank, 'catalogue.json'))) {
    const reason = `no built SFX bank at ${bank} (TAALCUT_SFX_BANK; tools/audio-packs/sfx-bank builds it)`;
    return outcomeOf('listen-pick', {
      metrics: [],
      skipped: [{ part: 'queries', reason }],
      seconds: seconds(),
    });
  }
  const labels = pickLabels();
  const predictions = await predictPick(labels);
  const report = scorePick(labels, new Map(predictions.map((p) => [p.caseId, p])));
  writePickReport(report, join(outDir, 'cases.md'));
  const missed = report.cases.filter((c) => !c.hit);
  const over = `${report.cases.length} queries, ${here.found.dtype}`;
  return outcomeOf('listen-pick', {
    metrics: report.metrics.map((m) => ({ ...m, part: 'queries', over })),
    notes: [
      `Per query: cases.md. Missed (${missed.length}):`,
      ...missed.map((c) => `- ${c.caseId} "${c.query}" (${c.families.join(', ')}): ${c.top.join(', ')}`),
    ],
    seconds: seconds(),
  });
}
