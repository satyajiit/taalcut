// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: eval:make's report and its proposed bar, over every case's slots together: at least 90 % of the slots
 * the library can match matched and their needs met; every face the reel hides kept out; every reel graphic present
 * and 90 % in the reel's place; every case finished with video.done, no slot let stay that a shot could match; a
 * median of 3 drafts or fewer; at most one malformed call a case. The on-device 9B runs with no bar (its report says
 * where it stands). The first drafts' numbers are shown beside the last, so a run reads as what it fixed.
 */
import type { MakeRun, MakeScore } from './run';

export const MAKE_BAR = {
  slotsMatched: 0.9,
  needsMet: 0.9,
  facesHidden: 1,
  graphicsPresent: 1,
  graphicsPlaced: 0.9,
  done: 1,
  waivedWrong: 0,
  medianRounds: 3,
  malformedPerCase: 1,
} as const;

export interface MakeTotals {
  readonly slotsMatched: number;
  readonly needsMet: number;
  readonly facesHidden: number;
  readonly graphicsPresent: number;
  readonly graphicsPlaced: number;
}

export interface MakeReport {
  readonly model: string;
  /** False for a run with no bar (the on-device 9B). */
  readonly barred: boolean;
  readonly cases: number;
  readonly before: MakeTotals;
  readonly after: MakeTotals;
  readonly done: number;
  readonly waivedRight: number;
  readonly waivedWrong: number;
  readonly medianRounds: number;
  readonly malformed: number;
  readonly meetsBar: boolean;
  readonly misses: readonly string[];
  readonly runs: readonly MakeRun[];
}

const share = (part: number, whole: number) => (whole === 0 ? 1 : part / whole);
const median = (values: readonly number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

function totals(scores: readonly MakeScore[]): MakeTotals {
  const sum = (key: keyof MakeScore) => scores.reduce((total, score) => total + score[key], 0);
  return {
    slotsMatched: share(sum('slotsMatched'), sum('slots')),
    needsMet: share(sum('needsMet'), sum('needs')),
    facesHidden: share(sum('facesHidden'), sum('hidden')),
    graphicsPresent: share(sum('graphicsPresent'), sum('graphics')),
    graphicsPlaced: share(sum('graphicsPlaced'), sum('graphics')),
  };
}

export function makeReport(model: string, runs: readonly MakeRun[], barred: boolean): MakeReport {
  const after = totals(runs.map((run) => run.after));
  const done = runs.filter((run) => run.done).length;
  const waivedWrong = runs.reduce((sum, run) => sum + run.waivedWrong, 0);
  const medianRounds = median(runs.map((run) => run.rounds));
  const malformed = runs.reduce((sum, run) => sum + run.malformed.length, 0);
  const misses = [
    ...(after.slotsMatched < MAKE_BAR.slotsMatched ? ['slots matched'] : []),
    ...(after.needsMet < MAKE_BAR.needsMet ? ['needs met'] : []),
    ...(after.facesHidden < MAKE_BAR.facesHidden ? ['faces hidden'] : []),
    ...(after.graphicsPresent < MAKE_BAR.graphicsPresent ? ['graphics present'] : []),
    ...(after.graphicsPlaced < MAKE_BAR.graphicsPlaced ? ['graphics placed'] : []),
    ...(share(done, runs.length) < MAKE_BAR.done ? ['finished with video.done'] : []),
    ...(waivedWrong > MAKE_BAR.waivedWrong ? ['slots let stay that could match'] : []),
    ...(medianRounds > MAKE_BAR.medianRounds ? ['median drafts'] : []),
    ...(malformed > MAKE_BAR.malformedPerCase * runs.length ? ['malformed calls'] : []),
  ];
  return {
    model,
    barred,
    cases: runs.length,
    before: totals(runs.map((run) => run.before)),
    after,
    done,
    waivedRight: runs.reduce((sum, run) => sum + run.waivedRight, 0),
    waivedWrong,
    medianRounds,
    malformed,
    meetsBar: !barred || misses.length === 0,
    misses,
    runs,
  };
}

const pct = (value: number) => `${Math.round(value * 100)} %`;
const of = (part: number, whole: number) => `${part}/${whole}`;

export function makeReportMarkdown(report: MakeReport): string {
  const row = (label: string, key: keyof MakeTotals, bar: number) =>
    `| ${label} | ${pct(report.before[key])} | ${pct(report.after[key])} | ${pct(bar)} |`;
  const lines = [
    `# eval:make: ${report.model}`,
    '',
    `${report.cases} made-up reels. ${report.barred ? (report.meetsBar ? 'Bar met.' : `Bar not met: ${report.misses.join(', ')}.`) : 'No bar (on-device).'}`,
    '',
    '| | first draft | last | bar |',
    '|---|---|---|---|',
    row('Slots matched', 'slotsMatched', MAKE_BAR.slotsMatched),
    row('Needs met', 'needsMet', MAKE_BAR.needsMet),
    row('Faces kept out where hidden', 'facesHidden', MAKE_BAR.facesHidden),
    row('Reel graphics present', 'graphicsPresent', MAKE_BAR.graphicsPresent),
    row('Reel graphics in place', 'graphicsPlaced', MAKE_BAR.graphicsPlaced),
    '',
    `Finished with video.done: ${of(report.done, report.cases)}. Slots let stay with a reason: ${report.waivedRight} right, ${report.waivedWrong} that a shot could match. Median drafts: ${report.medianRounds} (bar ${MAKE_BAR.medianRounds}). Malformed calls: ${report.malformed}.`,
    '',
    '| case | slots | needs | faces hidden | graphics placed | drafts | done | turns | stopped |',
    '|---|---|---|---|---|---|---|---|---|',
    ...report.runs.map(
      (run) =>
        `| ${run.caseId} | ${of(run.before.slotsMatched, run.before.slots)} → ${of(run.after.slotsMatched, run.after.slots)} | ` +
        `${of(run.after.needsMet, run.after.needs)} | ${of(run.after.facesHidden, run.after.hidden)} | ` +
        `${of(run.after.graphicsPlaced, run.after.graphics)} | ${run.rounds} | ${run.done ? 'yes' : 'no'} | ${run.turns} | ${run.stopped}${run.error ? ` (${run.error})` : ''} |`,
    ),
  ];
  const malformed = report.runs.flatMap((run) =>
    run.malformed.map(
      (call) => `- ${run.caseId}: ${call.tool} ${call.code}${call.detail ? `: ${call.detail}` : ''}`,
    ),
  );
  if (malformed.length > 0) lines.push('', '## Malformed calls', '', ...malformed);
  const said = report.runs
    .filter((run) => run.said)
    .map((run) => `- ${run.caseId}: ${run.said.replace(/\s+/g, ' ')}`);
  if (said.length > 0) lines.push('', '## Last words', '', ...said);
  return `${lines.join('\n')}\n`;
}
