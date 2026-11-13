// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shot-boundary report: one section per detector (a stored library, a detector run), each with the
 * totals and a row per clip, and its timings when the run recorded them. Fades through black get their own
 * recall line and columns when the labels hold any (IX3-D3). JSON carries the same.
 */
import { clipTruth, type ClipTruth } from './truth';
import { scoreClip, shotScores, type ClipScore, type ShotScores } from './score';
import { decidedBy } from './decider';
import { loopSummary } from './loop-delay';
import type { LoopDelay, ShotLabels, ShotPredictions } from './schema';

export interface DetectorReport {
  readonly detector: string;
  readonly tolerance: number;
  readonly scores: ShotScores;
  readonly clips: readonly ClipScore[];
  /** Clips labelled but not predicted: scored as finding nothing. */
  readonly missingClips: readonly string[];
  /** Summed milliseconds per part, over the clips that recorded it. */
  readonly timings: Readonly<Record<string, number>>;
  /** The detector's thread's event-loop delay per clip, where the run recorded it. */
  readonly loop: readonly LoopDelay[];
  /** Clips per detector that decided them, where recorded (decider.ts). */
  readonly decidedBy: Readonly<Record<string, number>>;
}

export function reportDetector(
  labels: ShotLabels,
  predictions: ShotPredictions,
  tolerance: number,
): DetectorReport {
  const byFile = new Map(predictions.clips.map((clip) => [clip.file, clip]));
  const truths: ClipTruth[] = labels.clips.map(clipTruth);
  const clips = truths.map((truth) => scoreClip(truth, byFile.get(truth.file)?.boundaries ?? [], tolerance));
  const timings: Record<string, number> = {};
  for (const clip of predictions.clips)
    for (const [part, ms] of Object.entries(clip.timings ?? {})) timings[part] = (timings[part] ?? 0) + ms;
  return {
    detector: predictions.detector,
    tolerance,
    scores: shotScores(clips),
    clips,
    missingClips: truths.filter((truth) => !byFile.has(truth.file)).map((truth) => truth.file),
    timings,
    loop: predictions.clips.flatMap((clip) => (clip.loop ? [clip.loop] : [])),
    decidedBy: decidedBy(predictions),
  };
}

const fixed = (value: number) => value.toFixed(3);
const spans = (list: readonly { from: number; to: number }[]) =>
  list.map((d) => `${d.from}–${d.to}`).join(', ');

/** The per-clip table, with the fade columns when the labels hold fades. */
function clipTable(clips: readonly ClipScore[], fades: boolean): string[] {
  const fade = (yes: string) => (fades ? yes : '');
  return [
    `| Clip | Cuts found | Dissolves found |${fade(' Fades found |')} False | Missed cuts | Missed dissolves |` +
      `${fade(' Missed fades |')} False at |`,
    `| --- | --- | --- |${fade(' --- |')} --- | --- | --- |${fade(' --- |')} --- |`,
    ...clips.map(
      (clip) =>
        `| ${clip.file} | ${clip.cutsFound}/${clip.cuts} | ${clip.dissolvesFound}/${clip.dissolves} | ` +
        `${fade(`${clip.fadesFound}/${clip.fades} | `)}${clip.falseBoundaries} | ${clip.missedCuts.join(', ')} | ` +
        `${spans(clip.missedDissolves)} | ${fade(`${spans(clip.missedFades)} | `)}${clip.extra.join(', ')} |`,
    ),
  ];
}

export function detectorMarkdown(report: DetectorReport): string {
  const { scores, clips } = report;
  const c = scores.counts;
  const fades = c.fades > 0;
  const lines = [
    `## ${report.detector}`,
    '',
    `Tolerance ±${report.tolerance} frame${report.tolerance === 1 ? '' : 's'}. ` +
      `Cuts: precision ${fixed(scores.cut.precision)}, recall ${fixed(scores.cut.recall)}, ` +
      `**F1 ${fixed(scores.cut.f1)}** (${c.cutsFound}/${c.cuts} found, ${c.cutsExact} at the exact frame, ` +
      `${c.falseBoundaries} false). Dissolves: **recall ${fixed(scores.dissolveRecall)}** ` +
      `(${c.dissolvesFound}/${c.dissolves}). ` +
      (fades
        ? `Fades through black: **recall ${fixed(scores.fadeRecall)}** (${c.fadesFound}/${c.fades}). `
        : '') +
      `Every boundary: F1 ${fixed(scores.all.f1)}.`,
    '',
    ...clipTable(clips, fades),
  ];
  if (report.missingClips.length > 0) lines.push('', `Not predicted: ${report.missingClips.join(', ')}.`);
  const deciders = Object.entries(report.decidedBy);
  if (deciders.length > 0)
    lines.push(
      '',
      `Decided by: ${deciders.map(([detector, count]) => `${detector} ${count}`).join(', ')} clips.`,
    );
  const parts = Object.entries(report.timings);
  if (parts.length > 0)
    lines.push(
      '',
      `Time (ms, summed over clips): ${parts.map(([part, ms]) => `${part} ${Math.round(ms)}`).join(', ')}.`,
    );
  const loop = loopSummary(report.loop);
  if (loop) lines.push('', `Event-loop delay of the detector's thread (ms, over clips): ${loop}.`);
  return lines.join('\n');
}

export function shotsMarkdown(set: string, reports: readonly DetectorReport[]): string {
  return [`# Shot boundaries: ${set}`, ...reports.map(detectorMarkdown)].join('\n\n');
}
