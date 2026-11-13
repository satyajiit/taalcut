// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether a bench read on-screen text (OCR). Per run: in how many process samples of the indexing window the mac
 * helper was alive (it serves for the vision stages and leaves after a while idle), and how many of the library's
 * shots got on-screen text (the run's library copy). Per bench: the setup the runner checked (mac-helper.ts), how
 * many runs the helper ran in, the shot counts and, once the ocr lane's jobs report them, its counters (requests,
 * frames, Vision ms per frame; timeline/ocr-counts.ts) as median and spread. A bench without OCR is named so in its
 * summary and compare, and its numbers never become budgets.
 */
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { parseNamed } from '../../schema';
import { ocrSetupSchema, type OcrSetup } from './mac-helper';
import { spreadOf, spreadSchema } from './stats';

export interface TextShots {
  readonly shots: number;
  /** Shots whose on-screen text is not empty. */
  readonly textShots: number;
}

/** A run's OCR counters summed over its stage outputs (the timeline's OcrTotals has this shape and more). */
export interface OcrCounters {
  readonly requests: number;
  readonly frames: number;
  readonly engineMsPerFrame: number | null;
}

export interface RunOcr {
  /** Samples in the indexing window with the helper alive; null when the run kept no process samples. */
  readonly helperSamples: number | null;
  readonly shots: number | null;
  readonly textShots: number | null;
  /** Null before the jobs report counters. */
  readonly counters: OcrCounters | null;
}

export const benchOcrSchema = z.object({
  /** Null: the bench ran before the preflight and kept no setup. */
  setup: ocrSetupSchema.nullable(),
  /** Runs whose process samples show the helper, of the runs that kept samples. */
  helperRuns: z.int().nonnegative(),
  sampledRuns: z.int().nonnegative(),
  shots: spreadSchema,
  textShots: spreadSchema,
  /** The ocr lane's counters, medians over runs; absent in summaries from before them. */
  requests: spreadSchema.default(null),
  frames: spreadSchema.default(null),
  engineMsPerFrame: spreadSchema.default(null),
});
export type BenchOcr = z.output<typeof benchOcrSchema>;

const countsSchema = z.object({ shots: z.int().nonnegative(), textShots: z.int().nonnegative() });

/** Shot counts from a run's library copy; null when its schema has no on-screen text column. */
export function readTextShots(libraryPath: string): TextShots | null {
  const db = new DatabaseSync(libraryPath, { readOnly: true });
  try {
    const columns = db.prepare("SELECT name FROM pragma_table_info('shots')").all();
    if (!columns.some((column) => column.name === 'on_screen_text')) return null;
    const row = db
      .prepare(
        `SELECT count(*) AS shots,
                coalesce(sum(on_screen_text IS NOT NULL AND trim(on_screen_text) <> ''), 0) AS textShots
           FROM shots`,
      )
      .get();
    return parseNamed(countsSchema, row, `${libraryPath}: shots`);
  } finally {
    db.close();
  }
}

export function benchOcr(setup: OcrSetup | null, runs: readonly RunOcr[]): BenchOcr {
  const sampled = runs.filter((run) => run.helperSamples !== null);
  return {
    setup,
    helperRuns: sampled.filter((run) => (run.helperSamples ?? 0) > 0).length,
    sampledRuns: sampled.length,
    shots: spreadOf(runs.map((run) => run.shots)),
    textShots: spreadOf(runs.map((run) => run.textShots)),
    requests: spreadOf(runs.map((run) => run.counters?.requests)),
    frames: spreadOf(runs.map((run) => run.counters?.frames)),
    engineMsPerFrame: spreadOf(runs.map((run) => run.counters?.engineMsPerFrame)),
  };
}

/**
 * True when the bench read no on-screen text: set up without the helper, or (a bench from before the preflight)
 * the helper ran in none of its runs.
 */
export function withoutOcr(ocr: BenchOcr | null | undefined): boolean {
  if (ocr === null || ocr === undefined) return false;
  if (ocr.setup !== null) return ocr.setup.mode === 'off';
  return ocr.sampledRuns > 0 && ocr.helperRuns === 0;
}

/** True when every run read on-screen text with the helper: what a budget may be set from. */
export const fullOcr = (ocr: BenchOcr | null | undefined): boolean =>
  ocr?.setup?.mode === 'helper' && ocr.sampledRuns > 0 && ocr.helperRuns === ocr.sampledRuns;

const counters = (ocr: BenchOcr) =>
  ocr.requests === null || ocr.frames === null
    ? ''
    : `; OCR ${ocr.requests.median} requests, ${ocr.frames.median} frames` +
      `${ocr.engineMsPerFrame === null ? '' : `, ${ocr.engineMsPerFrame.median} Vision ms per frame`} (medians)`;

const counts = (ocr: BenchOcr) =>
  (ocr.textShots === null || ocr.shots === null
    ? 'shots with on-screen text: not read'
    : `shots with on-screen text: ${ocr.textShots.median} of ${ocr.shots.median} (median)`) + counters(ocr);

/** summary.md's line on OCR. */
export function ocrLine(ocr: BenchOcr): string {
  const ran = `the helper ran in ${ocr.helperRuns} of ${ocr.sampledRuns} runs`;
  if (ocr.setup?.mode === 'off')
    return (
      `**Without OCR** (${ocr.setup.reason ?? 'no mac helper'}): the app had no mac helper and read no ` +
      `on-screen text, so these numbers leave that work out; ${counts(ocr)}.`
    );
  if (ocr.setup?.helper)
    return (
      `On-screen text (OCR): mac helper ${ocr.setup.helper.version} (${ocr.setup.helper.path}` +
      `${ocr.setup.helper.sha256 === undefined ? '' : `, sha256 ${ocr.setup.helper.sha256.slice(0, 12)}`}); ${ran}; ` +
      `${counts(ocr)}.${ocr.helperRuns < ocr.sampledRuns ? ' Runs without it are flagged noisy.' : ''}`
    );
  return (
    `On-screen text (OCR): not checked when this bench ran (before the mac helper preflight); ${ran}; ` +
    `${counts(ocr)}.${withoutOcr(ocr) ? ' **Without OCR.**' : ''}`
  );
}
