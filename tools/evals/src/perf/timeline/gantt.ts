// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A text Gantt of a run (IX-B2), one line per stage row under its file, on a fixed width: '-' queued for a
 * slot, '#' running, a stage that ran shorter than a column still shows one '#'. Each file's header line marks
 * when it became searchable ('S') and complete ('C'). Below, how many jobs of each resource class ran at once
 * (a digit per column, the most in that column; '.' none).
 */
import type { AssetMilestones } from './milestones';
import { ran, type StageSpan } from './spans';

export interface GanttOptions {
  readonly width: number;
  readonly endMs: number;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function column(ms: number, options: GanttOptions): number {
  const at = Math.floor((ms / options.endMs) * options.width);
  return Math.max(0, Math.min(options.width - 1, at));
}

function bar(span: StageSpan, options: GanttOptions): string {
  const cells = Array.from({ length: options.width }, () => ' ');
  if (span.queuedMs !== null && span.startedMs !== null)
    for (let c = column(span.queuedMs, options); c < column(span.startedMs, options); c += 1) cells[c] = '-';
  if (ran(span)) {
    const from = column(span.startedMs, options);
    const to = Math.max(from, column(span.finishedMs, options));
    for (let c = from; c <= to; c += 1) cells[c] = '#';
  } else if (span.finishedMs !== null) cells[column(span.finishedMs, options)] = 'x';
  return cells.join('').trimEnd();
}

function marks(asset: AssetMilestones, options: GanttOptions): string {
  const cells = Array.from({ length: options.width }, () => ' ');
  if (asset.searchableMs !== null) cells[column(asset.searchableMs, options)] = 'S';
  if (asset.completeMs !== null) {
    const at = column(asset.completeMs, options);
    cells[at] = cells[at] === 'S' ? '*' : 'C';
  }
  return cells.join('').trimEnd();
}

function concurrency(spans: readonly StageSpan[], resource: string, options: GanttOptions): string {
  const cells = Array.from({ length: options.width }, () => 0);
  const step = options.endMs / options.width;
  for (let c = 0; c < options.width; c += 1) {
    const from = c * step;
    const to = from + step;
    // The most that overlapped this column: sample its start, middle and end.
    for (const at of [from, (from + to) / 2, to - 1]) {
      const open = spans.filter(
        (span) => span.resource === resource && ran(span) && span.startedMs <= at && span.finishedMs > at,
      ).length;
      cells[c] = Math.max(cells[c] ?? 0, open);
    }
  }
  return cells.map((open) => (open === 0 ? '.' : open > 9 ? '+' : String(open))).join('');
}

export function gantt(
  spans: readonly StageSpan[],
  assets: readonly AssetMilestones[],
  options: GanttOptions,
): string {
  const label = (text: string) => text.slice(0, 26).padEnd(26);
  const lines = [
    `0 → ${seconds(options.endMs)}, one column = ${seconds(options.endMs / options.width)}; ` +
      `'-' queued, '#' running, 'x' skipped, 'S' searchable, 'C' complete, '*' both in one column.`,
    '',
  ];
  for (const asset of assets) {
    lines.push(
      `${label(asset.file)}       |${marks(asset, options)}`,
      ...spans
        .filter((span) => span.assetId === asset.assetId)
        .sort(
          (left, right) =>
            (left.startedMs ?? left.finishedMs ?? 0) - (right.startedMs ?? right.finishedMs ?? 0),
        )
        .map(
          (span) =>
            `  ${label(span.stage).slice(0, 24)} ${(span.resource ?? '-').padEnd(6)}|${bar(span, options)}`,
        ),
    );
  }
  const resources = [
    ...new Set(spans.flatMap((span) => (span.resource === null ? [] : [span.resource]))),
  ].sort();
  lines.push('', 'Jobs running at once, per resource class:');
  for (const resource of resources)
    lines.push(`  ${label(resource).slice(0, 24)}       |${concurrency(spans, resource, options)}`);
  return lines.join('\n');
}
