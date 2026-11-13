// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the indexing e2e checks of TransNetV2's own process (IX2-S2, S10): which detector decided each file's shots
 * and where the model ran (the finished shots jobs' results: `model` is TransNetV2, `scdet` its fallback; `coreml`
 * the mac helper's Core ML, `webgpu` or `cpu` the ONNX process; the e2e's generated clips are one shot each, so
 * their cuts can't say), and the model processes alive now (the ONNX one by its service name, the helper's shots
 * service by its command line), so a test can see none outlives the jobs process.
 */
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { SHOT_MODEL_SERVICE } from '../src/shared/shot-model-ipc';
import { processesWith } from './durability-helpers';
import { libraryRows } from './library-rows';
import { utilityPids } from './utility-pids';

/**
 * How many files each detector decided and on which backend, and how many cuts each method placed, over every
 * finished shots job.
 */
export function shotDetectors(userData: string): {
  readonly detectors: Record<string, number>;
  readonly backends: Record<string, number>;
  readonly cuts: Record<string, number>;
} {
  const rows = libraryRows(
    userData,
    `SELECT result FROM jobs WHERE kind = 'vision.detectShots' AND state = 'succeeded' AND result IS NOT NULL`,
  ) as { result: string }[];
  const detectors: Record<string, number> = {};
  const backends: Record<string, number> = {};
  const cuts: Record<string, number> = {};
  const count = (into: Record<string, number>, key: string) => (into[key] = (into[key] ?? 0) + 1);
  for (const { result } of rows) {
    const shots = JSON.parse(result) as { detector?: string; backend?: string; cuts?: { method?: string }[] };
    count(detectors, shots.detector ?? 'none');
    if (shots.detector === 'model') count(backends, shots.backend ?? 'none');
    for (const cut of shots.cuts ?? []) count(cuts, cut.method ?? 'none');
  }
  return { detectors, backends, cuts };
}

/** The mac helper's shots services alive now, with their parents: the ones over this userData's Core ML model. */
export function shotsHelpersOf(userData: string): { pid: number; ppid: number; command: string }[] {
  return processesWith(join(userData, 'components', 'installed', 'transnetv2-coreml'));
}

/** The pids of the app's shot model processes now. */
export function shotModelPids(app: ElectronApplication): Promise<number[]> {
  return utilityPids(app, SHOT_MODEL_SERVICE);
}
