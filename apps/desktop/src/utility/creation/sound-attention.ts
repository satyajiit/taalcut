// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A4: what a creation's export must not ship with, from its QA report's soundCritique (the export heard in the
 * jobs process and critiqued against the 7 launch films: render's sound checks): a silent hole inside the film (a
 * seam between scenes where neither music nor voice plays), silence before the first sound, dead air at the end.
 * soundCritique only warns on a render; a creation is made start to finish by the agent, so these become a
 * timestamped note that leaves the creation for the person to look at instead of ready.
 */
import type { QaReport } from '@taalcut/core';

/** The critique's metrics that mean silence where the film should sound, and their words. */
const SILENCE: Readonly<Record<string, string>> = {
  maxGapS: 'a silent gap',
  firstSoundS: 'silence at the start',
  endSilenceS: 'dead air at the end',
};

const clock = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

/** One note per timed silence finding of the export's soundCritique (warning or not), e.g. "a silent gap at 0:12.40 in Launch 16:9". */
export function creationSoundNotes(report: QaReport | null, name: string): string[] {
  const check = report?.checks.find((c) => c.id === 'soundCritique');
  if (!check || check.status === 'skipped') return [];
  const notes: string[] = [];
  for (const finding of check.findings) {
    const what = finding.target ? SILENCE[finding.target.id] : undefined;
    if (!what) continue;
    const at = finding.measured?.unit === 'ms' ? clock(finding.measured.value) : null;
    // A metric's own row has no time; its timed fixes say where.
    if (at) notes.push(`${what} at ${at} in ${name}`);
  }
  // A silence metric out of range without a time (its fixes were capped): the film still needs a look.
  const untimed = check.findings.some((f) => f.target !== undefined && SILENCE[f.target.id] !== undefined);
  if (notes.length === 0 && untimed) notes.push(`silence where the film should sound in ${name}`);
  return [...new Set(notes)].slice(0, 6);
}
