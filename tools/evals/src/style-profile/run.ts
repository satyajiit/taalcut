// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The style profile suite (LRN1-STY): for each set, profileOf twice and on the members reversed must give
 * byte-identical JSON and digest (determinism); its numbers must match the hand-computed ones (the golden set); and
 * QA's stylePacing must pass the renders made like the set and fail the others (the pacing gate). The report is
 * markdown beside report.json; with any synthetic case it is never a gate claim.
 */
import { stylePacingCheck } from '@taalcut/render';
import { profileOf, styleProfileDigest, styleProfileJson } from '@taalcut/templates';
import type { StyleProfile } from '@taalcut/core';
import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import { writeReport } from '../report';
import type { ExpectedProfile, StyleProfileCase } from './schema';

export interface StyleCaseResult {
  readonly caseId: string;
  readonly synthetic: boolean;
  readonly deterministic: boolean;
  /** The fields that differ from the hand-computed numbers (empty: the case matches). */
  readonly mismatches: readonly string[];
  readonly renders: readonly {
    name: string;
    expect: 'pass' | 'fail';
    got: string;
    medianSeconds: number | null;
  }[];
}

export interface StyleProfileReport extends SuiteEnvelope {
  readonly suite: 'style-profile';
  readonly gate: { id: 'lrn1-sty-profile'; pass: boolean; detail: string };
  readonly cases: readonly StyleCaseResult[];
}

/** What profileOf gives, in the label's terms. */
function measured(profile: StyleProfile): ExpectedProfile {
  const top = (rows: readonly { value: string; count: number }[]) => rows[0]?.value ?? 'none';
  return {
    members: profile.members,
    shot: profile.pacing.shot,
    cutsOnBeat: profile.pacing.cutsOnBeat,
    shotsInFirst3s: profile.pacing.shotsInFirst3s,
    hookShotType: top(profile.hook.shotType),
    transitions: profile.mix.transitions.map((row) => ({ value: row.value, count: row.count })),
    length: profile.form.length,
    aspect: top(profile.form.aspect),
  };
}

function mismatches(expected: ExpectedProfile, got: ExpectedProfile): string[] {
  return (Object.keys(expected) as (keyof ExpectedProfile)[]).flatMap((field) =>
    JSON.stringify(expected[field]) === JSON.stringify(got[field])
      ? []
      : [`${field}: expected ${JSON.stringify(expected[field])}, got ${JSON.stringify(got[field])}`],
  );
}

/** Shots back to back at the render's rate, as QA reads them. */
const renderShots = (frames: readonly number[]) => {
  let start = 0;
  return frames.map((length, index) => {
    const span = { start, end: start + length };
    start += length;
    return { id: `shot${index + 1}`, span };
  });
};

export function evaluateStyleCase(item: StyleProfileCase): StyleCaseResult {
  const members = item.templates;
  const first = profileOf(members, null);
  const again = profileOf(members, null);
  const reversed = profileOf([...members].reverse(), null);
  const refs = members.map(({ id, version }) => ({ id, version }));
  const deterministic =
    first !== null &&
    again !== null &&
    reversed !== null &&
    styleProfileJson(first) === styleProfileJson(again) &&
    styleProfileJson(first) === styleProfileJson(reversed) &&
    styleProfileDigest(refs, null) === styleProfileDigest([...refs].reverse(), null);
  const renders = item.renders.map((render) => {
    const check = first
      ? stylePacingCheck({
          band: first.pacing.shot,
          shots: renderShots(render.shots),
          rate: { num: render.fps, den: 1 },
        })
      : null;
    return {
      name: render.name,
      expect: render.expect,
      got: check?.status ?? 'no profile',
      medianSeconds: check?.measured?.value ?? null,
    };
  });
  return {
    caseId: item.caseId,
    synthetic: item.synthetic,
    deterministic,
    mismatches: first ? mismatches(item.expected, measured(first)) : ['profile: none for a set with members'],
    renders,
  };
}

export function scoreStyleProfiles(cases: readonly StyleProfileCase[]): StyleProfileReport {
  const results = cases.map(evaluateStyleCase);
  const synthetic = cases.some((item) => item.synthetic);
  const deterministic = results.filter((row) => row.deterministic).length;
  const golden = results.filter((row) => row.mismatches.length === 0).length;
  const renders = results.flatMap((row) => row.renders);
  const verdicts = renders.filter((render) => render.got === render.expect).length;
  const pass =
    results.length > 0 &&
    deterministic === results.length &&
    golden === results.length &&
    verdicts === renders.length;
  const detail =
    `${deterministic} of ${results.length} sets byte-identical on rerun; ${golden} of ${results.length} match the ` +
    `hand-computed numbers; stylePacing gave ${verdicts} of ${renders.length} renders their expected verdict`;
  const share = (count: number, total: number) => (total === 0 ? 0 : count / total);
  return {
    suite: 'style-profile',
    synthetic,
    claimed: !synthetic,
    gate: { id: 'lrn1-sty-profile', pass, detail },
    metrics: [
      { name: 'deterministic', value: share(deterministic, results.length), better: 'higher' },
      { name: 'golden', value: share(golden, results.length), better: 'higher' },
      { name: 'pacingVerdicts', value: share(verdicts, renders.length), better: 'higher' },
    ],
    cases: results,
  };
}

export function renderStyleProfileMarkdown(report: StyleProfileReport): string {
  return [
    '# What a set of references has in common',
    '',
    envelopeBlock(report),
    '',
    '| set | byte-identical | matches the hand count | renders: expected → QA |',
    '| --- | --- | --- | --- |',
    ...report.cases.map(
      (row) =>
        `| ${row.caseId} | ${row.deterministic ? 'yes' : 'no'} | ` +
        `${row.mismatches.length === 0 ? 'yes' : row.mismatches.join('; ')} | ` +
        `${row.renders.map((render) => `${render.name} ${render.expect} → ${render.got} (${render.medianSeconds ?? '–'} s)`).join('; ')} |`,
    ),
    '',
  ].join('\n');
}

export function writeStyleProfileReport(report: StyleProfileReport, markdownPath: string): void {
  writeReport(markdownPath, renderStyleProfileMarkdown(report), report);
}
