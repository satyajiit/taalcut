// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The on-screen text recall report (IX3-B1): per library, per known line, the words read and missed and what OCR
 * stored around the line; then each library's `gate:` line, whether the libraries read the same words, and the
 * verdict. A refused library is named with why and fails the run (it fails closed). JSON beside the markdown.
 */
import { basename, dirname } from 'node:path';
import { gateLine, gateOf, type GateResult, type TextBaseline } from './baseline';
import type { LibraryRead } from './library';
import { foundKeys, scoreLibrary, type LibraryScore } from './score';
import type { KnownLine } from './words';

export const WORD_RULE =
  'A word is read when it equals a whole token of the on-screen text stored on any shot of its file ' +
  '(upper-cased; tokens are runs of ASCII letters and digits, Latin-1 letters and Devanagari).';

export type LibraryResult =
  | {
      readonly kind: 'scored';
      readonly name: string;
      readonly score: LibraryScore;
      readonly gate: GateResult;
    }
  | {
      readonly kind: 'refused';
      readonly name: string;
      readonly path: string;
      readonly reasons: readonly string[];
    };

export interface TextRecallReport {
  readonly v: 1;
  readonly manifest: string;
  readonly set: string | null;
  readonly rule: string;
  readonly baseline: { readonly path: string; readonly from: string; readonly minFound: number } | null;
  readonly minFound: number;
  readonly libraries: readonly LibraryResult[];
  /** Whether every scored library read the same words; null with fewer than two. */
  readonly agree: boolean | null;
  /** Every library scored and passed its gate. */
  readonly pass: boolean;
}

/** `<label>/run-<n>` for a bench run's library copy, else the path. */
export function libraryName(path: string): string {
  const run = dirname(path);
  return /^run-\d+$/.test(basename(run)) ? `${basename(dirname(run))}/${basename(run)}` : path;
}

export interface ReportInput {
  readonly manifest: string;
  readonly set: string | null;
  readonly lines: readonly KnownLine[];
  readonly reads: readonly LibraryRead[];
  readonly baseline: { readonly path: string; readonly value: TextBaseline } | null;
  readonly minFound: number;
}

export function textRecallReport(input: ReportInput): TextRecallReport {
  const libraries: LibraryResult[] = input.reads.map((read) => {
    if (read.kind === 'refused')
      return { kind: 'refused', name: libraryName(read.path), path: read.path, reasons: read.reasons };
    const score = scoreLibrary(read.text, input.lines);
    const gate = gateOf(score, input.baseline?.value ?? null, input.minFound);
    return { kind: 'scored', name: libraryName(read.text.path), score, gate };
  });
  const scored = libraries.flatMap((library) => (library.kind === 'scored' ? [library] : []));
  const words = scored.map((library) => foundKeys(library.score).join(' '));
  return {
    v: 1,
    manifest: input.manifest,
    set: input.set,
    rule: WORD_RULE,
    baseline:
      input.baseline === null
        ? null
        : {
            path: input.baseline.path,
            from: input.baseline.value.from,
            minFound: input.baseline.value.minFound,
          },
    minFound: input.minFound,
    libraries,
    agree: scored.length < 2 ? null : words.every((set) => set === words[0]),
    pass:
      libraries.length > 0 && libraries.every((library) => library.kind === 'scored' && library.gate.pass),
  };
}

/** One `gate:` line for a library: its verdict against the floor and the baseline, or why it was refused. */
export function libraryGateLine(library: LibraryResult): string {
  return library.kind === 'refused'
    ? `gate: FAIL ${library.name}: refused (${library.reasons.join('; ')})`
    : gateLine(library.name, library.gate);
}

const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' / ');
const row = (cells: readonly string[]) => `| ${cells.map(cell).join(' | ')} |`;

function librarySection(library: LibraryResult): string[] {
  if (library.kind === 'refused')
    return [
      `## ${library.name}: refused`,
      '',
      'Not scored, because its text is not the shipped pipeline’s:',
      ...library.reasons.map((reason) => `- ${reason}`),
      '',
      libraryGateLine(library),
    ];
  const { score } = library;
  return [
    `## ${library.name}: ${score.found} of ${score.total} words`,
    '',
    row(['File', 'Line', 'Read', 'Missed', 'Stored around the line']),
    row(['---', '---', '---', '---', '---']),
    ...score.lines.map((line) =>
      row([
        line.file,
        line.line,
        line.found.join(' ') || '–',
        line.missed.join(' ') || '–',
        line.read.map((text) => `“${text}”`).join(', ') || 'nothing',
      ]),
    ),
    '',
    libraryGateLine(library),
  ];
}

export function textRecallMarkdown(report: TextRecallReport): string {
  const baseline =
    report.baseline === null
      ? `No baseline: the floor of ${report.minFound} words only.`
      : `Baseline ${report.baseline.path} (from ${report.baseline.from}); floor ${report.minFound} words, and no ` +
        'word the baseline read may be lost.';
  const agreement =
    report.agree === null
      ? []
      : [report.agree ? 'The libraries read the same words.' : '**The libraries read different words.**', ''];
  const lines = [
    `# On-screen text recall${report.set === null ? '' : `: ${report.set}`}`,
    '',
    `Manifest ${report.manifest}. ${report.rule}`,
    baseline,
    '',
    ...report.libraries.flatMap((library) => [...librarySection(library), '']),
    ...agreement,
    `**${report.pass ? 'Pass' : 'Fail'}**: ${report.libraries.length} librar${report.libraries.length === 1 ? 'y' : 'ies'}.`,
  ];
  return `${lines.join('\n')}\n`;
}
