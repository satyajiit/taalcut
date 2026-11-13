// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.md (IX-B2): the finish lines and how they were read, each asset's searchable and complete times,
 * resource classes and lanes (busy against wall), both critical paths with where their time went, busy time per
 * file and stage, the decode counters, and the text Gantt.
 */
import type { CriticalPath } from './critical-path';
import { gantt } from './gantt';
import type { Usage } from './lanes';
import { decodesSection, filesSection, ocrSection } from './per-file-markdown';
import type { TimelineReport } from './timeline-report';

/** Shorter waits are the engine's own latency; the table leaves them out. */
const SHOWN_WAIT_MS = 100;

const s = (ms: number | null) => (ms === null ? '–' : (ms / 1000).toFixed(1));
const row = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
const rule = (count: number) => row(Array.from({ length: count }, () => '---'));

function usageTable(title: string, usage: readonly Usage[]): string[] {
  return [
    `### ${title}`,
    '',
    row([
      'Name',
      'Jobs',
      'Busy (s)',
      'Wall (s)',
      'Busy / wall',
      'Most at once',
      'First start (s)',
      'Last finish (s)',
    ]),
    rule(8),
    ...usage.map((item) =>
      row([
        item.name,
        String(item.jobs),
        s(item.busyMs),
        s(item.wallMs),
        item.overlap.toFixed(2),
        String(item.peak),
        s(item.firstStartMs),
        s(item.lastFinishMs),
      ]),
    ),
    '',
  ];
}

function pathSection(title: string, path: CriticalPath | null): string[] {
  if (path === null) return [`### ${title}`, '', 'Not reached in this run.', ''];
  const share = (ms: number) => `${s(ms)} s (${Math.round((ms / path.endMs) * 100)}%)`;
  const sums = (record: Readonly<Record<string, number>>) =>
    Object.entries(record)
      .sort((left, right) => right[1] - left[1])
      .map(([name, ms]) => `${name} ${share(ms)}`)
      .join(', ');
  return [
    `### ${title}: ${s(path.endMs)} s, ending with ${path.target.file} ${path.target.stage}`,
    '',
    `By kind: ${sums(path.byType)}.`,
    `Runs by stage: ${sums(path.byStage)}.`,
    `Runs by resource class: ${sums(path.byResource)}.`,
    '',
    `Waits under ${s(SHOWN_WAIT_MS)} s are left out of the table (timeline.json has every segment).`,
    '',
    row(['From (s)', 'To (s)', 'What', 'File', 'Stage', 'Class / lane']),
    rule(6),
    ...path.segments
      .filter((segment) => segment.type === 'run' || segment.toMs - segment.fromMs >= SHOWN_WAIT_MS)
      .map((segment) =>
        row([
          s(segment.fromMs),
          s(segment.toMs),
          segment.type,
          segment.file ?? '–',
          segment.stage ?? '–',
          segment.resource === null ? '–' : `${segment.resource}${segment.lane ? ` / ${segment.lane}` : ''}`,
        ]),
      ),
    '',
  ];
}

/** The finish lines, how they were read, and any disagreement with the stored ones. */
function headline(report: TimelineReport): string[] {
  const ruleText =
    report.searchableRule.source === 'declared'
      ? `the stages that declare milestone 'searchable' (${report.searchableRule.stages.join(', ')})`
      : `computed from design C's stage set (${report.searchableRule.stages.join(', ')}), since no stage declares a milestone yet`;
  return [
    '# Indexing timeline',
    '',
    `Times in seconds from Add folder. ${report.videoSeconds} s of video.`,
    '',
    `- **Searchable**: ${s(report.searchableMs)} s (${report.searchableMinPerHour ?? '–'} min/h), ${ruleText}.` +
      (report.searchableStored ? ` Stored by the library: ${s(report.storedSearchableMs)} s.` : ''),
    `- **Fully analysed**: ${s(report.completeMs)} s (${report.completeMinPerHour ?? '–'} min/h), the last stage row's finish.` +
      (report.completeStored ? ` Stored by the library: ${s(report.storedCompleteMs)} s.` : '') +
      (report.completeHeldForModel > 0
        ? ` Leaves out ${report.completeHeldForModel} descriptions held for their model, not installed here.`
        : ''),
    ...(report.mismatches.length === 0
      ? []
      : [
          `- **Stored and computed disagree** (ready lane): ` +
            report.mismatches
              .map((m) => `${m.file} ${m.line} computed ${s(m.computedMs)} s, stored ${s(m.storedMs)} s`)
              .join('; ') +
            '.',
        ]),
    '',
  ];
}

export function timelineMarkdown(report: TimelineReport): string {
  const endMs = Math.max(1, report.completeMs ?? 0, ...report.spans.map((span) => span.finishedMs ?? 0));
  const looks = new Map(
    report.files.flatMap((file) => (file.looks === null ? [] : [[file.file, file.looks] as const])),
  );
  const lines = [
    ...headline(report),
    '## Assets',
    '',
    row(['File', 'Kind', 'Searchable (s)', 'Last searchable stage', 'Complete (s)']),
    rule(5),
    ...[...report.assets]
      .sort((left, right) => (left.searchableMs ?? Infinity) - (right.searchableMs ?? Infinity))
      .map((asset) =>
        row([
          asset.file,
          asset.assetKind,
          s(asset.searchableMs),
          asset.searchableBy ?? '–',
          s(asset.completeMs),
        ]),
      ),
    '',
    '## Resource classes and lanes',
    '',
    ...usageTable('Classes', report.usage.classes),
    ...usageTable('Lanes', report.usage.lanes),
    '## Critical paths',
    '',
    ...pathSection('To searchable', report.criticalPath.searchable),
    ...pathSection('To fully analysed', report.criticalPath.complete),
    ...filesSection(report.files),
    ...decodesSection(report.decodes),
    ...ocrSection(report.ocr, looks),
    '## Library-wide jobs',
    '',
    row(['Kind', 'Class', 'State', 'Queued (s)', 'Started (s)', 'Finished (s)']),
    rule(6),
    ...report.libraryJobs.map((job) =>
      row([job.kind, job.resource, job.state, s(job.queuedMs), s(job.startedMs), s(job.finishedMs)]),
    ),
    '',
    '## Gantt',
    '',
    '```',
    gantt(report.spans, report.assets, { width: 100, endMs }),
    '```',
  ];
  return `${lines.join('\n')}\n`;
}
