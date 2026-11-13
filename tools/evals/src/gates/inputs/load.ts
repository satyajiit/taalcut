// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { parseWith } from './parse';
import { loadCiDir } from './ci-results';
import { loadCohorts } from './cohorts';
import { loadCrashes } from './crashes';
import { loadEvalReports } from './eval-reports';
import { loadManual } from './manual';
import { loadSessions } from './sessions';
import { loadTelemetry } from './telemetry';
import { type Absent, type GateInputs } from './types';
import { dateWindow } from '../window';

const gateSchema = z.enum(['beta', 'v1']);

export interface GatePaths {
  gate: string;
  from: string;
  to: string;
  telemetry?: string;
  evals?: string;
  sessions?: string;
  crashes?: string;
  ci?: string;
  manual?: string;
  cohorts?: string;
}

const absent: Absent = { kind: 'absent' };

/** A missing optional path is an absent source. A path that is set and unreadable throws. */
export function loadGateInputs(paths: GatePaths): GateInputs {
  const gate = parseWith(gateSchema, paths.gate, '--gate');
  const window = dateWindow(paths.from, paths.to);
  const cohorts = loadCohorts(paths.cohorts);
  const ciDir = paths.ci === undefined ? null : loadCiDir(paths.ci);
  return {
    gate,
    from: paths.from,
    to: paths.to,
    fromMs: window.fromMs,
    toMs: window.toMs,
    telemetry:
      paths.telemetry === undefined
        ? absent
        : loadTelemetry(paths.telemetry, cohorts, window.fromMs, window.toMs),
    evals: paths.evals === undefined ? absent : loadEvalReports(paths.evals),
    sessions: paths.sessions === undefined ? absent : loadSessions(paths.sessions),
    crashes: paths.crashes === undefined ? absent : loadCrashes(paths.crashes),
    ci: ciDir === null ? absent : ciDir.ci,
    perf: ciDir === null ? absent : ciDir.perf,
    manual: paths.manual === undefined ? absent : loadManual(paths.manual),
  };
}
