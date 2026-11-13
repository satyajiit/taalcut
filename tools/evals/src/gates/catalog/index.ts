// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type GateId, type GateMetric } from '../gate-metric';
import { accessibility } from './accessibility';
import { activation } from './activation';
import { autoSelectAcceptance } from './autoSelectAcceptance';
import { breakdownAccuracy } from './breakdownAccuracy';
import { costPerVideo } from './costPerVideo';
import { crashFree } from './crashFree';
import { exportRate } from './exportRate';
import { languagesReady } from './languagesReady';
import { manualSignOff } from './manualSignOff';
import { performance } from './performance';
import { qaFirstPass } from './qaFirstPass';
import { retentionWeek4 } from './retentionWeek4';
import { searchTop5 } from './searchTop5';
import { timeToFirstVideo } from './timeToFirstVideo';
import { updateAndRollback } from './updateAndRollback';
import { weeklyOutput } from './weeklyOutput';

/** One import per metric. Adding a gate metric is a new module, not a new switch arm. */
export const GATE_METRICS: readonly GateMetric[] = [
  activation,
  timeToFirstVideo,
  autoSelectAcceptance,
  breakdownAccuracy,
  qaFirstPass,
  exportRate,
  weeklyOutput,
  retentionWeek4,
  costPerVideo,
  crashFree,
  searchTop5,
  updateAndRollback,
  languagesReady,
  accessibility,
  performance,
  manualSignOff,
];

export function coveredGateRows(): { beta: number[]; v1: number[] } {
  const beta = new Set<number>();
  const v1 = new Set<number>();
  for (const metric of GATE_METRICS) {
    for (const binding of metric.bindings) {
      const set: Set<number> = binding.gate === 'beta' ? beta : v1;
      set.add(binding.row);
    }
  }
  const sort = (rows: Set<number>) => [...rows].sort((left, right) => left - right);
  return { beta: sort(beta), v1: sort(v1) };
}

export function metricById(id: string): GateMetric | undefined {
  return GATE_METRICS.find((metric) => metric.id === id);
}

export type { GateId };
