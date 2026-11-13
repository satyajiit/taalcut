// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F6 against upstream earshot (tools/earshot-parity): `earshot sfx check` on the bank renders, with and without
 * the category. Done when the findings are identical; the raw measures are compared too.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { soundAuditReportSchema } from '@taalcut/core';
import { auditSound, toSoundAuditReport } from '../../src/listen/dsp/audit';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { cli, loadClip } from '../../../../tools/earshot-parity/fixtures.mjs';

interface Check {
  readonly ok: boolean;
  readonly warnings: Array<{ code: string }>;
  readonly notes: Array<{ code: string }>;
  readonly measures: Record<string, number | null>;
  readonly glide: { rise_st: number; tonal_share: number };
  readonly layers: { count: number; pre_swell_ms: number };
}

const MEASURES: Array<[string, string, number]> = [
  ['clicks', 'clicks', 0],
  ['edge_db', 'edgeDb', 0.1],
  ['clip_runs', 'clipRuns', 0],
  ['dc_db', 'dcDb', 0.2],
  ['ring_z', 'ringZ', 0.5],
  ['trunc_db', 'truncDb', 0.2],
  ['silence_ms', 'silenceMs', 0.1],
  ['bump_db', 'bumpDb', 0.2],
  ['attack_ms', 'attackMs', 0.01],
  ['t40_ms', 't40Ms', 0],
  ['crest_db', 'crestDb', 0.1],
  ['res_hz', 'resHz', 1],
  ['peak_dbfs', 'peakDbfs', 0.01],
  ['live_ms', 'liveMs', 0.01],
];

const runner = createSpectrogramRunner();
const report: string[] = [];
afterAll(async () => {
  await runner.release();
  if (process.env.TAALCUT_LISTEN_REPORT) console.warn(report.join('\n'));
});

describe('the audit against upstream earshot', () => {
  it('gives identical findings on every bank render', async () => {
    let runs = 0;
    let same = 0;
    let measures = 0;
    let measuresOk = 0;
    for (const [runId, run] of Object.entries(cli<Check>('sfx-check'))) {
      const [id] = runId.split('::');
      const category = run.argv.includes('--category')
        ? run.argv[run.argv.indexOf('--category') + 1]
        : undefined;
      const clip = loadClip(id as string);
      const audit = await auditSound(
        { sampleRate: clip.sampleRate, channels: clip.channels },
        runner,
        category ? { category } : {},
      );
      const codes = (items: ReadonlyArray<{ code: string }>) =>
        items
          .map((i) => i.code)
          .sort()
          .join(',');
      const ok =
        audit.ok === run.result.ok &&
        codes(audit.warnings) === codes(run.result.warnings) &&
        codes(audit.notes) === codes(run.result.notes);
      runs++;
      if (ok) same++;
      else
        report.push(
          `${runId}: ${codes(audit.warnings)} | ${codes(audit.notes)} vs ${codes(run.result.warnings)} | ${codes(run.result.notes)}`,
        );
      for (const [theirs, mine, tol] of MEASURES) {
        const want = run.result.measures[theirs];
        const got = (audit.measures as unknown as Record<string, number | null>)[mine];
        measures++;
        const fine =
          want === null || want === undefined
            ? got === null || got === undefined
            : got !== null && got !== undefined && Math.abs(got - want) <= tol + 1e-9;
        if (fine) measuresOk++;
        else report.push(`  ${runId} ${theirs}: ${got} vs ${want}`);
      }
      if (Math.abs(audit.glide.riseSt - run.result.glide.rise_st) > 0.1)
        report.push(`  ${runId} glide ${audit.glide.riseSt} vs ${run.result.glide.rise_st}`);
      if (audit.layers.count !== run.result.layers.count)
        report.push(`  ${runId} layers ${audit.layers.count} vs ${run.result.layers.count}`);
      expect(soundAuditReportSchema.safeParse(toSoundAuditReport(audit)).success).toBe(true);
    }
    report.push(
      `audit findings identical ${same}/${runs}; measures within tolerance ${measuresOk}/${measures}`,
    );
    expect(same).toBe(runs);
  }, 60_000);
});
