// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The ocr lane's counters (specs/requests-ocr-to-bench.md): what each job that read on-screen text reported in its
 * output (`ocr`; today `vision.analyse`, from IX-O5 `vision.ocr`), summed per file and per run, beside the busy time
 * of the stages that carried them. Vision's own time per frame (`ms.engine / frames`) is the number to watch. Whether
 * the mac helper ran is the run summary's (ocr.ts): without it these stay empty.
 */
import type { StageRow } from './library-rows';

export interface OcrTotals {
  readonly requests: number;
  readonly frames: number;
  /** Absent when the jobs did not report them. */
  readonly sampled: number | null;
  readonly reused: number | null;
  readonly refineCalls: number;
  readonly refineDecodes: number;
  /** Vision's own time, summed over images (the helper measures it). */
  readonly engineMs: number;
  readonly engineMsPerFrame: number | null;
  /** Busy time of the stage jobs that reported the counters. */
  readonly busyMs: number;
}

export interface OcrReport {
  /** Stage rows that reported `ocr`, and the ones in another shape (left out). */
  readonly rows: number;
  readonly unreadable: number;
  readonly stages: readonly string[];
  readonly totals: OcrTotals;
  /** Per file, the most requests first. */
  readonly files: readonly ({ readonly file: string } & OcrTotals)[];
}

interface Sum {
  requests: number;
  frames: number;
  sampled: number | null;
  reused: number | null;
  refineCalls: number;
  refineDecodes: number;
  engineMs: number;
  busyMs: number;
}

const empty = (): Sum => ({
  requests: 0,
  frames: 0,
  sampled: null,
  reused: null,
  refineCalls: 0,
  refineDecodes: 0,
  engineMs: 0,
  busyMs: 0,
});

const plus = (total: number | null, value: number | undefined) =>
  value === undefined ? total : (total ?? 0) + value;

function add(sum: Sum, row: StageRow): void {
  const ocr = row.ocr;
  if (ocr === null) return;
  sum.requests += ocr.requests;
  sum.frames += ocr.frames;
  sum.sampled = plus(sum.sampled, ocr.sampled);
  sum.reused = plus(sum.reused, ocr.reused);
  sum.refineCalls += ocr.refineCalls;
  sum.refineDecodes += ocr.refineDecodes;
  sum.engineMs += ocr.ms.engine;
  const started = row.jobStartedAt ?? row.startedAt;
  const finished = row.jobFinishedAt ?? row.finishedAt;
  if (started !== null && finished !== null && finished >= started) sum.busyMs += finished - started;
}

const totals = (sum: Sum): OcrTotals => ({
  ...sum,
  engineMsPerFrame: sum.frames === 0 ? null : Math.round((sum.engineMs / sum.frames) * 10) / 10,
});

/** Null when no stage row reported OCR counters (before the ocr lane's meter, or without the helper). */
export function ocrReport(rows: readonly StageRow[]): OcrReport | null {
  const counted = rows.filter((row) => row.ocr !== null);
  const unreadable = rows.filter((row) => row.ocrUnreadable).length;
  if (counted.length === 0 && unreadable === 0) return null;
  const run = empty();
  const byFile = new Map<string, Sum>();
  for (const row of counted) {
    add(run, row);
    const file = byFile.get(row.file) ?? empty();
    byFile.set(row.file, file);
    add(file, row);
  }
  return {
    rows: counted.length,
    unreadable,
    stages: [...new Set(counted.map((row) => row.stage))].sort(),
    totals: totals(run),
    files: [...byFile.entries()]
      .map(([file, sum]) => ({ file, ...totals(sum) }))
      .sort((a, b) => b.requests - a.requests),
  };
}
