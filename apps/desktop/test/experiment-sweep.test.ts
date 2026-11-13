// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process sweeps reference experiments at start and hourly (P2-T3):
 * an expired experiment a crashed breakdown left in `<userData>/scratch` is
 * gone after the jobs root starts; a live one stays, and so does every reel a
 * template keeps in `<userData>/templates/media` (REF1).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, newId, ok, UnknownError, type ExperimentId } from '@taalcut/core';
import {
  scratchRoot,
  startExperimentSweep,
  startExperimentSweeps,
} from '../src/utility/roots/experiment-sweep';
import { composeJobs } from '../src/utility/roots/jobs-root';
import { templatesRoot } from '../src/shared/template-assets';
import { testConfig } from './helpers/roots';

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An experiment folder as the sandbox writes it, with a download inside. */
function experiment(root: string, expiresAt: number): ExperimentId {
  const id = newId<'Experiment'>() as ExperimentId;
  mkdirSync(join(root, id, 'tmp'), { recursive: true });
  const manifest = {
    version: 1,
    id,
    projectId: null,
    purpose: 'breakdown',
    createdAt: 1,
    expiresAt,
    ttlMs: 7_200_000,
  };
  writeFileSync(join(root, id, 'experiment.json'), JSON.stringify(manifest));
  writeFileSync(join(root, id, 'reference.mp4'), 'reel');
  return id;
}

describe('experiment sweep', () => {
  it('the jobs root removes expired experiments at start and keeps live ones', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'taalcut-sweep-'));
    dirs.push(userData);
    const root = scratchRoot(userData);
    const expired = experiment(root, Date.now() - 1000);
    const live = experiment(root, Date.now() + 3_600_000);
    const kept = join(templatesRoot(userData), 'media', newId<'Template'>(), 'reference.mp4');
    mkdirSync(dirname(kept), { recursive: true });
    writeFileSync(kept, 'a template keeps its reel');
    const jobs = composeJobs({ ...testConfig('jobs'), userData }, { pid: 1, jobs: [] });
    try {
      await jobs.start?.();
      await startExperimentSweeps(jobs.container).first;
      expect(existsSync(join(root, expired))).toBe(false);
      expect(existsSync(join(root, live, 'reference.mp4'))).toBe(true);
      expect(existsSync(kept)).toBe(true);
    } finally {
      await jobs.container.dispose();
    }
  });

  it('sweeps hourly, logs a failed sweep and keeps going, and stops', async () => {
    vi.useFakeTimers();
    const results = [err(UnknownError()), ok({ removed: [newId<'Experiment'>() as ExperimentId] })];
    const sweep = vi.fn(async () => results.shift() ?? ok({ removed: [] }));
    const log = vi.fn();
    const handle = startExperimentSweep({ sweep, log });
    await handle.first;
    expect(log).toHaveBeenCalledWith('sweep failed: core.unknown');
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenLastCalledWith('swept 1 experiment(s)');
    handle.stop();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});
