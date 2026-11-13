// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type GateCell } from '../../src/gates/gate-metric';
import { type GateReport } from '../../src/gates/report/build';

export function findCell(
  report: GateReport,
  query: {
    metricId: string;
    cohort?: GateCell['slice']['cohort'];
    language?: GateCell['slice']['language'];
    row?: number;
    runner?: string;
    release?: string;
  },
): GateCell {
  const found = report.cells.filter((cell) => {
    if (cell.metricId !== query.metricId) return false;
    if ((query.cohort ?? 'all') !== cell.slice.cohort) return false;
    if ((query.language ?? 'all') !== cell.slice.language) return false;
    if (query.row !== undefined && cell.row !== query.row) return false;
    if ((query.runner ?? null) !== (cell.slice.runner ?? null)) return false;
    if ((query.release ?? null) !== (cell.slice.release ?? null)) return false;
    return true;
  });
  const cell = found[0];
  if (cell === undefined || found.length !== 1) {
    throw new Error(`expected one ${query.metricId} cell, found ${found.length}`);
  }
  return cell;
}
