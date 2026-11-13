// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the edit eval's report: the pass rate per family and for asks that point ("this", "here"), malformed
 * calls and out-of-target changes, against the bar: at least 85% of the non-graphics cases pass, no call in them
 * is malformed, and no case changes what it wasn't about. Graphics cases are reported, their malformed calls too, but held to no bar (lane gfx's own eval
 * measures them, and the graphics tools are gfx's).
 */
import { EDIT_FAMILIES, type EditFamily } from './case-types';
import type { CaseRun } from './run';

export const EDIT_BAR = { nonGraphics: 0.85, malformed: 0, outOfTarget: 0 } as const;

export interface Tally {
  readonly n: number;
  readonly passed: number;
}

export interface EditReport {
  readonly model: string;
  readonly mode: 'live' | 'replay';
  readonly families: readonly ({ readonly family: EditFamily } & Tally)[];
  readonly pointed: Tally;
  readonly nonGraphics: Tally & { readonly rate: number };
  /** Malformed calls in every case, and in the non-graphics cases (the bar's). */
  readonly malformed: number;
  readonly malformedNonGraphics: number;
  readonly outOfTarget: number;
  /** Cases that proposed a graphic the request wasn't about (not committed, so not out of target). */
  readonly proposedUnasked: number;
  readonly meetsBar: boolean;
  readonly cases: readonly CaseRun[];
}

const tally = (runs: readonly CaseRun[]): Tally => ({ n: runs.length, passed: runs.filter((run) => run.pass).length });

export function editReport(model: string, mode: EditReport['mode'], runs: readonly CaseRun[]): EditReport {
  const nonGraphics = tally(runs.filter((run) => run.family !== 'graphics'));
  const rate = nonGraphics.n === 0 ? 0 : nonGraphics.passed / nonGraphics.n;
  const malformed = runs.reduce((sum, run) => sum + run.malformed.length, 0);
  const outOfTarget = runs.filter((run) => run.outOfTarget.length > 0).length;
  const malformedNonGraphics = runs
    .filter((run) => run.family !== 'graphics')
    .reduce((sum, run) => sum + run.malformed.length, 0);
  return {
    model,
    mode,
    families: EDIT_FAMILIES.map((family) => ({ family, ...tally(runs.filter((run) => run.family === family)) })).filter(
      (row) => row.n > 0,
    ),
    pointed: tally(runs.filter((run) => run.pointed)),
    nonGraphics: { ...nonGraphics, rate },
    malformed,
    malformedNonGraphics,
    outOfTarget,
    proposedUnasked: runs.filter((run) => (run.proposed ?? []).length > 0).length,
    meetsBar: rate >= EDIT_BAR.nonGraphics && malformedNonGraphics <= EDIT_BAR.malformed && outOfTarget <= EDIT_BAR.outOfTarget,
    cases: runs,
  };
}

const percent = (tallied: Tally) => (tallied.n === 0 ? '–' : `${Math.round((100 * tallied.passed) / tallied.n)}%`);

export function editReportMarkdown(report: EditReport): string {
  const lines = [
    '# Edit requests eval',
    '',
    `Model: ${report.model} (${report.mode}). ${report.cases.length} cases.`,
    '',
    `- **Non-graphics:** ${report.nonGraphics.passed} of ${report.nonGraphics.n} pass (${percent(report.nonGraphics)}; the bar is ${EDIT_BAR.nonGraphics * 100}%).`,
    `- **Malformed calls:** ${report.malformedNonGraphics} in the non-graphics cases (the bar is ${EDIT_BAR.malformed}); ${report.malformed} in all.`,
    `- **Out of target:** ${report.outOfTarget} case(s) changed something the request wasn't about (the bar is ${EDIT_BAR.outOfTarget}).`,
    `- **Proposed, not asked for:** ${report.proposedUnasked} case(s) proposed a graphic the request wasn't about (not used, so the video didn't change; not out of target).`,
    `- **"This" and "here":** ${report.pointed.passed} of ${report.pointed.n} pass (${percent(report.pointed)}).`,
    `- **Bar:** ${report.meetsBar ? 'met' : 'not met'}.`,
    '',
    '| Family | Cases | Pass | Rate |',
    '| --- | --- | --- | --- |',
    ...report.families.map((row) => `| ${row.family} | ${row.n} | ${row.passed} | ${percent(row)} |`),
    '',
    '## Cases',
    '',
    '| Case | Family | Result | Calls | What the Editor said |',
    '| --- | --- | --- | --- | --- |',
    ...report.cases.map((run) => {
      const calls = run.calls.filter((call) => !['findTools', 'updatePlan', 'readArtifact'].includes(call.tool));
      const named = calls.map((call) => (call.ok ? call.tool : `${call.tool} ✗ ${call.error}`)).join(', ');
      const said = run.said.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 160);
      const proposed = (run.proposed ?? []).length > 0 ? ' (proposed a graphic not asked for)' : '';
      return `| ${run.caseId} | ${run.family} | ${run.pass ? 'pass' : `fail: ${run.why.replace(/\|/g, '/')}`}${proposed} | ${named} | ${said} |`;
    }),
  ];
  return `${lines.join('\n')}\n`;
}
