// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * summary.md for people: whether the app read on-screen text (a bench without it says so in its title) and which
 * engine transcribed and how often each video was decoded, the headline numbers as median and spread, noisy and failed runs, the per-stage busy table and
 * one line per run.
 */
import type { BenchSummary } from './aggregate';
import { budgetMarkdown } from './budgets';
import { ocrLine, withoutOcr } from './ocr';
import { decodesLine } from './decodes';
import { fallbacksLine } from './fallbacks';
import { textRecallLine } from './text-recall';
import { transcriptLine } from './transcripts';
import type { RunSummary } from './run-summary';
import { round, type Spread } from './stats';

const GB = 1024 ** 3;

export type HeadlineKey = keyof BenchSummary['headline'];

/** What summary.md and compare read: the headline spreads by key. */
export interface HasHeadline {
  readonly headline: Readonly<Partial<Record<HeadlineKey, Spread | null>>>;
}

export interface Measure {
  readonly name: string;
  readonly key: HeadlineKey;
  /** From the stored unit to the shown one. */
  readonly scale: number;
  readonly places: number;
  /** Every bench number is better lower so far; kept so compare's verdict reads it, not assumes it. */
  readonly better: 'lower' | 'higher';
}

const measure = (name: string, key: HeadlineKey, scale = 1, places = 1): Measure => ({
  name,
  key,
  scale,
  places,
  better: 'lower',
});

export const HEADLINE_MEASURES: readonly Measure[] = [
  measure('Searchable (min/h)', 'searchableMinPerHour'),
  measure('Fully analysed (min/h)', 'completeMinPerHour'),
  measure('Add folder to settled, as Phase 3 (min/h)', 'elapsedMinPerHour'),
  measure('Jobs process and children, peak RSS (GB)', 'jobsTreePeakBytes', 1 / GB, 2),
  measure('Agent process and children, peak RSS (GB)', 'agentTreePeakBytes', 1 / GB, 2),
  measure('Security agents CPU, mean (% of a core)', 'securityMeanCpuPercent', 1, 0),
  measure('Security agents CPU, busiest second (%)', 'securityMaxCpuPercent', 1, 0),
  measure(
    'Media daemons CPU (mediaanalysisd, photoanalysisd, Spotlight), mean (%)',
    'backgroundMeanCpuPercent',
    1,
    0,
  ),
  measure('Media daemons CPU, busiest second (%)', 'backgroundMaxCpuPercent', 1, 0),
  measure('Load average while indexing, mean', 'loadMean'),
];

export const pick = (summary: HasHeadline, by: Measure): Spread | null => summary.headline[by.key] ?? null;

export function shown(value: number | null | undefined, scale = 1, places = 1): string {
  return value === null || value === undefined ? '–' : String(round(value * scale, places));
}

export function spreadCells(spread: Spread | null, scale = 1, places = 1): string[] {
  if (spread === null) return ['–', '–', '–', '0'];
  return [
    shown(spread.median, scale, places),
    shown(spread.min, scale, places),
    shown(spread.max, scale, places),
    String(spread.n),
  ];
}

export const row = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;

function runLine(run: RunSummary): string {
  return row([
    String(run.run),
    shown(run.searchableMinPerHour),
    shown(run.completeMinPerHour),
    shown(run.elapsedMinPerHour),
    shown(run.memory.jobs?.treePeakBytes, 1 / GB, 2),
    shown(run.security?.meanPercent, 1, 0),
    shown(run.background?.meanPercent, 1, 0),
    `${shown(run.load.start)} / ${shown(run.load.mean)}`,
    run.noise.noisy ? run.noise.reasons.join('; ') : 'no',
  ]);
}

/** Fully analysed leaves out descriptions held for their model (LIB1-FIX): said, so a bench with it isn't misread. */
function heldLine(runs: BenchSummary['runs']): string[] {
  const held = runs.map((run) => run.completeHeldForModel ?? 0);
  const most = Math.max(0, ...held);
  return most === 0
    ? []
    : [
        `Fully analysed leaves out the descriptions held for their model, which this seed doesn't install ` +
          `(up to ${most} a run): a bench with the model installed describes them and is slower by that work.`,
      ];
}

export function summaryMarkdown(summary: BenchSummary): string {
  const machine = summary.machine;
  const facts = machine
    ? `${machine.chip}, ${Math.round(machine.memoryBytes / GB)} GB, ${machine.cpuCores} cores` +
      `${machine.gpuCores === null ? '' : `, ${machine.gpuCores} GPU cores`}, ${machine.os}`
    : 'no run finished';
  const lines = [
    `# Indexing bench: ${summary.label}${withoutOcr(summary.ocr) ? ' (without OCR)' : ''}`,
    '',
    `${summary.tier} tier forced (this Mac assesses ${summary.tierAssessed ?? '?'}); footage ${summary.footage}: ` +
      `${summary.files ?? '?'} files, ${summary.videoSeconds ?? '?'} s of video. ` +
      `${summary.runsFinished} of ${summary.runsAsked} runs finished. ${facts}.`,
    '',
    ocrLine(summary.ocr),
    transcriptLine(summary.runs.map((run) => run.transcripts)),
    decodesLine(summary.runs.map((run) => run.decodes)),
    fallbacksLine(summary.fallbacks),
    textRecallLine(summary.runs.map((run) => run.textRecall)),
    '',
    'Development numbers on a Mac running Sophos and FortiClient: indicative, not gate evidence.',
    'Searchable and fully analysed are timed from Add folder by the stage rows (timeline.md per run).',
    ...heldLine(summary.runs),
    '',
    row(['Number', 'Median', 'Min', 'Max', 'Runs']),
    row(['---', '---', '---', '---', '---']),
    ...HEADLINE_MEASURES.map((by) => row([by.name, ...spreadCells(pick(summary, by), by.scale, by.places)])),
    '',
    summary.noisyRuns.length === 0
      ? 'Noisy runs: none.'
      : `Noisy runs: ${summary.noisyRuns.map((noisy) => `run ${noisy.run} (${noisy.reasons.join('; ')})`).join('; ')}.`,
    summary.failedRuns.length === 0
      ? 'Runs that measured nothing: none.'
      : `Runs that measured nothing: ${summary.failedRuns.join(', ')}.`,
    summary.e2eFailedRuns.length === 0
      ? 'Runs whose e2e failed after measuring: none.'
      : `Runs whose e2e failed after measuring (counted; see run.log): ${summary.e2eFailedRuns.join(', ')}.`,
    '',
    '## Stages: busy and wall time (s)',
    '',
    row(['Stage', 'Busy median', 'Busy min', 'Busy max', 'Wall median', 'Wall min', 'Wall max']),
    row(['---', '---', '---', '---', '---', '---', '---']),
    ...summary.stages.map((stage) =>
      row([
        stage.stage,
        ...spreadCells(stage.busyMs, 1 / 1000, 1).slice(0, 3),
        ...spreadCells(stage.wallMs, 1 / 1000, 1).slice(0, 3),
      ]),
    ),
    '',
    ...(summary.budgets === undefined ? [] : [...budgetMarkdown(summary.budgets), '']),
    '## Runs',
    '',
    row([
      'Run',
      'Searchable',
      'Complete',
      'Elapsed',
      'Jobs GB',
      'Security %',
      'Media daemons %',
      'Load start / mean',
      'Noisy',
    ]),
    row(['---', '---', '---', '---', '---', '---', '---', '---', '---']),
    ...summary.runs.map(runLine),
  ];
  return `${lines.join('\n')}\n`;
}
