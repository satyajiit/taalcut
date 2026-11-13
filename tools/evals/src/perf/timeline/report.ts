// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A run's timeline (IX-B2): the stage spans, the two finish lines per asset and overall (min/h too; the ready
 * lane's stored values beside the computed ones, any disagreement named), the resource classes' and lanes' busy
 * against wall, the critical path to each finish line, each file's busy time per stage, and the decode counters. `timeline.json`
 * for tools, `timeline.md` (with the text Gantt) for people. The bench runner calls `analyseTimeline` for
 * every run; its finish lines go into run-summary.json.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson, writeText } from '../../files';
import { RUN_FILES } from '../bench/layout';
import type { RunRecord } from '../bench/run-record';
import type { FinishLines } from '../bench/run-summary';
import type { TranscriptJobs } from '../bench/transcripts';
import { minutesPerHour, round } from '../bench/stats';
import { criticalPath, lastFinished } from './critical-path';
import { laneUsage } from './lanes';
import { readLibraryRows } from './library-rows';
import { timelineMarkdown } from './markdown';
import { assetMilestones, overall, searchableRule, type AssetMilestones } from './milestones';
import { ocrReport } from './ocr-counts';
import { busyByFile, decodeReport, footageLooks } from './per-file';
import { stageSpans, type StageSpan } from './spans';
import type { TimelineReport } from './timeline-report';

export type { TimelineReport } from './timeline-report';

/** Stored and computed finish lines further apart than this are named (both come from the same rows). */
export const MISMATCH_MS = 5;

type Pair = (asset: AssetMilestones) => readonly [number | null, number | null];

function mismatches(assets: readonly AssetMilestones[], stored: { searchable: boolean; complete: boolean }) {
  const searchable: Pair = (a) => [a.searchableMs, a.storedSearchableMs];
  const complete: Pair = (a) => [a.completeMs, a.storedCompleteMs];
  const lines = [
    ['searchable', stored.searchable, searchable],
    ['complete', stored.complete, complete],
  ] as const;
  return lines.flatMap(([line, present, pick]) =>
    present
      ? // A description held for its model: the library rightly stores no complete_at, the computed line leaves it out.
        assets.flatMap((asset) => {
          if (line === 'complete' && asset.heldForModel > 0) return [];
          const [computedMs, storedMs] = pick(asset);
          const apart =
            computedMs === null || storedMs === null
              ? computedMs !== storedMs
              : Math.abs(computedMs - storedMs) > MISMATCH_MS;
          return apart ? [{ file: asset.file, line, computedMs, storedMs }] : [];
        })
      : [],
  );
}

function searchablePath(
  spans: readonly StageSpan[],
  assets: readonly AssetMilestones[],
  needs: (s: string) => string[],
) {
  let last: AssetMilestones | null = null;
  for (const asset of assets)
    if (asset.searchableMs !== null && (last === null || asset.searchableMs > (last.searchableMs ?? 0)))
      last = asset;
  const target = spans.find((span) => span.assetId === last?.assetId && span.stage === last.searchableBy);
  return target === undefined ? null : criticalPath(spans, target, needs);
}

export function buildTimeline(
  libraryPath: string,
  record: RunRecord,
  looks: ReadonlyMap<string, readonly string[]> = new Map(),
): TimelineReport {
  const rows = readLibraryRows(libraryPath, record.addedAt);
  const spans = stageSpans(rows.stages, record.addedAt, record.pipeline);
  const rule = searchableRule(record.pipeline);
  const assets = assetMilestones(spans, rule, rows.storedSearchableAt, record.addedAt, rows.storedCompleteAt);
  const needsByStage = new Map(record.pipeline.stages.map((stage) => [stage.stage, stage.needs]));
  const needs = (stage: string) => needsByStage.get(stage) ?? [];
  const searchableMs = overall(assets, (asset) => asset.searchableMs);
  const completeMs = overall(assets, (asset) => asset.completeMs);
  const storedSearchableMs =
    rows.storedSearchableAt === null ? null : overall(assets, (a) => a.storedSearchableMs);
  const perHour = (ms: number | null) =>
    ms === null ? null : round(minutesPerHour(ms, record.videoSeconds));
  const last = lastFinished(spans);
  const at = (value: number | null) => (value === null ? null : value - record.addedAt);
  return {
    v: 1,
    addedAt: record.addedAt,
    videoSeconds: record.videoSeconds,
    searchableRule: rule,
    searchableStored: rows.storedSearchableAt !== null,
    searchableMs,
    searchableMinPerHour: perHour(searchableMs),
    storedSearchableMs,
    completeMs,
    completeMinPerHour: perHour(completeMs),
    completeStored: rows.storedCompleteAt !== null,
    storedCompleteMs: rows.storedCompleteAt === null ? null : overall(assets, (a) => a.storedCompleteMs),
    completeHeldForModel: assets.reduce((sum, asset) => sum + asset.heldForModel, 0),
    mismatches: mismatches(assets, {
      searchable: rows.storedSearchableAt !== null,
      complete: rows.storedCompleteAt !== null,
    }),
    files: busyByFile(spans, looks),
    decodes: decodeReport(rows.stages),
    ocr: ocrReport(rows.stages),
    assets,
    usage: laneUsage(spans),
    criticalPath: {
      searchable: searchablePath(spans, assets, needs),
      complete: last === null ? null : criticalPath(spans, last, needs),
    },
    libraryJobs: rows.libraryJobs.map((job) => ({
      kind: job.kind,
      resource: job.resource,
      state: job.state,
      queuedMs: job.queuedAt - record.addedAt,
      startedMs: at(job.startedAt),
      finishedMs: at(job.finishedAt),
    })),
    spans,
  };
}

/** Reads the run's library copy into timeline.json and timeline.md; null when the run left no library. */
export function analyseTimeline(runDir: string, record: RunRecord): FinishLines | null {
  const library = join(runDir, RUN_FILES.library);
  if (!existsSync(library)) return null;
  const report = buildTimeline(library, record, looksOf(record.footage.dir));
  writeJson(join(runDir, RUN_FILES.timeline), report);
  writeText(join(runDir, RUN_FILES.timelineMarkdown), timelineMarkdown(report));
  // The stored value is the product's own answer once it exists; the computed one stays in the report.
  return {
    searchableMs: report.storedSearchableMs ?? report.searchableMs,
    completeMs: report.storedCompleteMs ?? report.completeMs,
    completeHeldForModel: report.completeHeldForModel,
    ocr: report.ocr?.totals ?? null,
    transcripts: transcriptJobs(report.spans),
    decodes:
      report.decodes === null
        ? null
        : {
            originalFullDecodes: report.decodes.medianOriginalFullDecodes,
            spawns: report.decodes.medianSpawns,
          },
  };
}

/** The jobs that ran the audio.transcript rows, by kind, and the rows that ran none. */
function transcriptJobs(spans: TimelineReport['spans']): TranscriptJobs {
  const kinds: Record<string, number> = {};
  let skipped = 0;
  for (const span of spans.filter((row) => row.stage === 'audio.transcript'))
    if (span.kind === null) skipped += 1;
    else kinds[span.kind] = (kinds[span.kind] ?? 0) + 1;
  return { kinds, skipped };
}

/** A generated set's looks per file; none when the set has no manifest or it no longer reads (a decoration only). */
function looksOf(dir: string): ReadonlyMap<string, readonly string[]> {
  try {
    return footageLooks(dir);
  } catch {
    return new Map();
  }
}
