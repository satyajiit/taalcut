// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { eventsNamed } from '../events';
import {
  absentCell,
  formatMinutes,
  judgeSample,
  mapSlices,
  markedSynthetic,
  type GateMetric,
  type Measured,
  type NumericTarget,
} from '../gate-metric';
import { isPresent, type InstallRollup, type UsabilitySession } from '../inputs/types';
import { bootstrapMedian, censoredMedian } from '../stats';
import { cohortLanguageSlices, matchesSlice, type CellSlice } from '../slices';

/** The plan's beta row 7: "4 moderated sessions". Fewer is `too few`, not a verdict. */
const SESSION_MIN_N = 4;

/**
 * Installs that onboarded in the window (first seen at or after `--from`, with an `onboarding.step`). The value is
 * `onboarding.firstExport.ms` (Get started to the first ready export), or null when the install never exported.
 */
function installMinutes(install: InstallRollup): number | null | undefined {
  if (!install.newInWindow) return undefined;
  if (eventsNamed(install.envelopes, 'onboarding.step').length === 0) return undefined;
  const exported = eventsNamed(install.envelopes, 'onboarding.firstExport')[0];
  return exported === undefined ? null : exported.event.ms / 60_000;
}

/**
 * Telemetry is the median over installs that exported: activation already gates the share that never do, and an
 * install can still export after the window. A moderated session is over when it ends, so every session counts and
 * one with no export sorts after every exporter (`censored`).
 */
interface Side {
  label: string;
  values: readonly (number | null)[];
  censored: boolean;
}

function exportersOnly(side: Side): Side {
  return side.censored ? side : { ...side, values: side.values.filter((value) => value !== null) };
}

function sideText(side: Side): string {
  if (side.values.length === 0) return `${side.label} absent`;
  const point = censoredMedian(exportersOnly(side).values);
  const noExport = side.values.filter((value) => value === null).length;
  const shown =
    point === null ? 'none exported' : point === 'not reached' ? 'not reached' : formatMinutes(point);
  return `${side.label} ${shown} (n=${side.values.length}, ${noExport} no export)`;
}

function sideMeasured(full: Side, target: NumericTarget, minN: number, detail: string): Measured {
  const side = exportersOnly(full);
  const point = censoredMedian(side.values);
  const n = side.values.length;
  if (point === 'not reached') {
    // Half or more never exported: the median is longer than anything observed, so a `<=` bar is missed.
    return {
      value: null,
      n,
      interval: null,
      detail,
      display: 'not reached',
      verdict: n < minN ? 'too few' : 'fail',
    };
  }
  if (point === null) {
    return { value: null, n: null, interval: null, detail, display: 'no data', verdict: 'missing input' };
  }
  const observed = side.values.filter((value): value is number => value !== null);
  const boot = observed.length === n ? bootstrapMedian(observed) : null;
  return {
    value: point,
    n,
    interval: boot === null ? null : boot.interval,
    detail,
    display: formatMinutes(point),
    verdict: judgeSample(point, n, target, minN),
  };
}

function measured(telemetry: Side, sessions: Side, target: NumericTarget): Measured {
  const detail = `${sideText(telemetry)}; ${sideText(sessions)}`;
  if (telemetry.values.length === 0 && sessions.values.length === 0) {
    return { value: null, n: null, interval: null, detail, display: 'no data', verdict: 'missing input' };
  }
  // The row needs both sides, so a disagreement can be seen. The session median then decides.
  if (telemetry.values.length === 0 || sessions.values.length === 0) {
    const shown = sessions.values.length === 0 ? telemetry : sessions;
    return { ...sideMeasured(shown, target, 1, detail), verdict: 'missing input' };
  }
  return sideMeasured(sessions, target, SESSION_MIN_N, detail);
}

function sides(installs: readonly InstallRollup[], records: readonly UsabilitySession[], slice: CellSlice) {
  const telemetry: (number | null)[] = [];
  for (const install of installs) {
    if (!matchesSlice(install.cohort, install.language, slice)) continue;
    const minutes = installMinutes(install);
    if (minutes !== undefined) telemetry.push(minutes);
  }
  // Sessions are not a telemetry cohort: every cohort slice sees every session of the language.
  const sessions = records
    .filter((session) => slice.language === 'all' || session.language === slice.language)
    .map((session) => (session.seconds === null ? null : session.seconds / 60));
  return {
    telemetry: { label: 'telemetry', values: telemetry, censored: false },
    sessions: { label: 'sessions', values: sessions, censored: true },
  };
}

export const timeToFirstVideo: GateMetric = {
  id: 'timeToFirstVideo',
  label: 'Time to first video',
  source: 'telemetry+sessions',
  bindings: [
    {
      gate: 'beta',
      row: 7,
      cohort: 'fresh-beta',
      minN: SESSION_MIN_N,
      target: { op: '<=', value: 20, unit: 'minutes' },
    },
    {
      gate: 'v1',
      row: 1,
      cohort: 'all',
      minN: SESSION_MIN_N,
      target: { op: '<=', value: 15, unit: 'minutes' },
    },
  ],
  compute(inputs, binding) {
    const telemetry = inputs.telemetry;
    const sessions = inputs.sessions;
    const target = binding.target;
    if (target.op === 'pass') throw new Error('timeToFirstVideo needs a numeric target');
    if (!isPresent(telemetry) && !isPresent(sessions)) {
      return [absentCell(this, binding, 'telemetry absent; sessions absent')];
    }
    const installs: readonly InstallRollup[] = isPresent(telemetry) ? telemetry.installs : [];
    const records: readonly UsabilitySession[] = isPresent(sessions) ? sessions.sessions : [];
    const baseSources = [
      ...(isPresent(telemetry) ? telemetry.sources : []),
      ...(isPresent(sessions) ? sessions.sources : []),
    ];
    return mapSlices(
      this,
      binding,
      baseSources,
      markedSynthetic(baseSources),
      cohortLanguageSlices(),
      (slice) => {
        const both = sides(installs, records, slice);
        return measured(both.telemetry, both.sessions, target);
      },
    );
  },
};
