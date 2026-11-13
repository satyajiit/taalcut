// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** CPU, wall-clock, file-size and experiment-size limits stop runs with their errors (P2-T2). */
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { confinedSkipReason, execSandbox, experimentId, skipMessage, tempRoot } from './helpers/sandbox';

const skip = confinedSkipReason();
skipMessage('sandbox limits', skip);

let temp: { root: string; cleanup: () => void };
beforeEach(() => {
  temp = tempRoot();
});
afterEach(() => temp.cleanup());

async function opened(extra: Parameters<typeof execSandbox>[1] = {}) {
  const made = execSandbox(join(temp.root, 'root'), extra);
  const id = experimentId();
  await made.sandbox.open({ id, projectId: null, purpose: 'analysis' });
  return { ...made, id };
}

/** CPU-bound for minutes unless something stops it. */
const BUSY = ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3600', '-f', 'null', '-'];

describe.skipIf(skip !== '')('limits', { timeout: 120_000 }, () => {
  it('stops a run over its CPU seconds (FFmpeg exits on SIGXCPU and says so)', async () => {
    const { sandbox, id } = await opened();
    const result = await sandbox.run(id, {
      program: 'ffmpeg',
      args: BUSY,
      limits: { cpuSeconds: 1, threads: 1 },
    });
    expect(!result.ok && result.error).toMatchObject({ code: 'sandbox.cpu_limit', params: { seconds: 1 } });
  });

  it('stops a run over its wall clock, retryably', async () => {
    const { sandbox, id } = await opened();
    const result = await sandbox.run(id, { program: 'ffmpeg', args: BUSY, limits: { wallMs: 800 } });
    expect(!result.ok && result.error).toMatchObject({ code: 'sandbox.time_limit', retryable: true });
  });

  it('stops a file over the largest-file limit', async () => {
    const { sandbox, id } = await opened();
    const result = await sandbox.run(id, {
      program: 'ffmpeg',
      args: [
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x240:rate=30:duration=10',
        '-f',
        'rawvideo',
        'scratch:big.raw',
      ],
      limits: { maxFileBytes: 64 * 1024 },
    });
    expect(!result.ok && result.error).toMatchObject({
      code: 'sandbox.disk_limit',
      params: { bytes: 64 * 1024 },
    });
  });

  it('stops a run that grows the experiment past its cap', async () => {
    const { sandbox, id } = await opened();
    const result = await sandbox.run(id, {
      program: 'ffmpeg',
      args: [
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=640x480:rate=30:duration=600',
        '-f',
        'rawvideo',
        'scratch:big.raw',
      ],
      limits: { diskBytes: 2 * 1024 ** 2 },
    });
    expect(!result.ok && result.error).toMatchObject({
      code: 'sandbox.disk_limit',
      params: { bytes: 2 * 1024 ** 2 },
    });
  });

  it('checks the free space first', async () => {
    const { sandbox, id } = await opened({ freeSpaceReserve: Number.MAX_SAFE_INTEGER });
    const result = await sandbox.run(id, { program: 'ffmpeg', args: BUSY });
    expect(!result.ok && result.error.code).toBe('sandbox.disk_limit');
  });

  it('a cancelled run is core.cancelled and its group is gone', async () => {
    const { sandbox, id } = await opened();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const result = await sandbox.run(id, { program: 'ffmpeg', args: BUSY }, { signal: controller.signal });
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    const already = await sandbox.run(id, { program: 'ffmpeg', args: BUSY }, { signal: AbortSignal.abort() });
    expect(!already.ok && already.error.code).toBe('core.cancelled');
  });

  it('without sandbox-exec nothing runs unconfined', async () => {
    const { sandbox, id } = await opened({ sandboxExec: '/nowhere/sandbox-exec' });
    const result = await sandbox.run(id, { program: 'ffmpeg', args: BUSY });
    expect(!result.ok && result.error.code).toBe('sandbox.unavailable');
    const broken = await opened({ profilesDir: join(temp.root, 'no-profiles') });
    const missing = await broken.sandbox.run(broken.id, {
      program: 'ffmpeg',
      args: ['-f', 'lavfi', '-i', 'color=red:duration=0.1', '-f', 'null', '-'],
    });
    expect(!missing.ok && missing.error.code).toBe('sandbox.unavailable');
    const unknown = await broken.sandbox.run(experimentId(), { program: 'ffmpeg', args: [] });
    expect(!unknown.ok && unknown.error.code).toBe('sandbox.experiment_not_found');
  });
});
