// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.md's per-file sections: busy per stage and file, the decode counters (per-file.ts) and the OCR
 * counters (ocr-counts.ts).
 */
import type { OcrReport, OcrTotals } from './ocr-counts';
import type { DecodeReport, FileBusy } from './per-file';

const s = (ms: number | undefined) => (ms === undefined ? '–' : (ms / 1000).toFixed(1));
const row = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
const rule = (count: number) => row(Array.from({ length: count }, () => '---'));

/** Stages as columns, busiest first over all files; files busiest first. */
export function filesSection(files: readonly FileBusy[]): string[] {
  const totals = new Map<string, number>();
  for (const file of files)
    for (const [stage, ms] of Object.entries(file.busyMs)) totals.set(stage, (totals.get(stage) ?? 0) + ms);
  const stages = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([stage]) => stage);
  const looks = files.some((file) => file.looks !== null);
  return [
    '## Busy per file (s)',
    '',
    "Each stage job's run (finish minus start), per file; the busiest files first." +
      (looks
        ? " Looks: the generated set's shots in order (`pattern` is lavfi testsrc2, with a running clock)."
        : ''),
    '',
    row(['File', 'Kind', 'Total', ...stages, ...(looks ? ['Looks'] : [])]),
    rule(3 + stages.length + (looks ? 1 : 0)),
    ...files.map((file) =>
      row([
        file.file,
        file.assetKind,
        s(file.totalMs),
        ...stages.map((stage) => s(file.busyMs[stage])),
        ...(looks ? [file.looks?.join(', ') ?? '–'] : []),
      ]),
    ),
    '',
  ];
}

export function decodesSection(report: DecodeReport | null): string[] {
  if (report === null) return [];
  const median = (value: number | null) => (value === null ? '–' : String(value));
  return [
    '## Decodes (stage outputs)',
    '',
    `${report.rows} stage rows reported decodes${report.unreadable > 0 ? `; ${report.unreadable} in another shape, left out` : ''}. ` +
      `Per video file, median: ${median(report.medianOriginalFullDecodes)} full decodes of the original (target 2), ` +
      `${median(report.medianSpawns)} FFmpeg and ffprobe spawns.`,
    '',
    row(['Stage', 'FFmpeg', 'ffprobe', 'Full decodes', 'Partial decodes', 'Original full decodes']),
    rule(6),
    ...report.byStage.map((stage) =>
      row([
        stage.stage,
        String(stage.ffmpeg),
        String(stage.ffprobe),
        String(stage.fullDecodes),
        String(stage.partialDecodes),
        String(stage.originalFullDecodes),
      ]),
    ),
    '',
  ];
}

const n = (value: number | null) => (value === null ? '–' : String(value));

function ocrCells(totals: OcrTotals): string[] {
  return [
    String(totals.requests),
    String(totals.frames),
    n(totals.sampled),
    n(totals.reused),
    String(totals.refineCalls),
    String(totals.refineDecodes),
    s(totals.engineMs),
    n(totals.engineMsPerFrame),
    s(totals.busyMs),
  ];
}

export function ocrSection(
  report: OcrReport | null,
  looks: ReadonlyMap<string, readonly string[]>,
): string[] {
  if (report === null) return [];
  const withLooks = looks.size > 0;
  return [
    '## OCR (stage outputs)',
    '',
    `${report.rows} rows of ${report.stages.join(', ')} reported OCR counters` +
      `${report.unreadable > 0 ? `; ${report.unreadable} in another shape, left out` : ''}. ` +
      "Vision (s) is the engine's own time summed over images; busy is the reporting stage jobs' run.",
    '',
    row([
      'File',
      'Requests',
      'Frames',
      'Sampled',
      'Reused',
      'Refine calls',
      'Refine decodes',
      'Vision (s)',
      'Vision ms / frame',
      'Busy (s)',
      ...(withLooks ? ['Looks'] : []),
    ]),
    rule(10 + (withLooks ? 1 : 0)),
    row(['**Run**', ...ocrCells(report.totals), ...(withLooks ? [''] : [])]),
    ...report.files.map((file) =>
      row([file.file, ...ocrCells(file), ...(withLooks ? [looks.get(file.file)?.join(', ') ?? '–'] : [])]),
    ),
    '',
  ];
}
