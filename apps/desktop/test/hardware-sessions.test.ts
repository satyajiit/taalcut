// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app-wide hardware video session cap as the desktop wires it: the
 * limit follows the hardware tier, and the jobs and render processes each
 * register the gate their media contexts wait on. No FFmpeg runs here.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HARDWARE_SESSION_LIMITS } from '@taalcut/media';
import {
  appHardwareSessions,
  hardwareSessionDir,
  HardwareSessionsToken,
  sessionContext,
} from '../src/utility/roots/hardware-sessions';
import { composeRender } from '../src/utility/roots/render-root';
import type { UtilityRoot } from '../src/utility/runtime';
import { fakeHardware, testConfig, testJobs } from './helpers/roots';

const dirs: string[] = [];
const roots: UtilityRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await root.container.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-hw-desktop-'));
  dirs.push(dir);
  return dir;
};

describe('hardware session cap (desktop)', { timeout: 20_000 }, () => {
  it('takes its limit from the hardware tier, and the lowest when the probe fails', async () => {
    const tier = (await fakeHardware()).assessment.tier;
    expect(await appHardwareSessions(fakeHardware, scratch()).limit()).toBe(HARDWARE_SESSION_LIMITS[tier]);
    const failed = appHardwareSessions(() => Promise.reject(new Error('no system_profiler')), scratch());
    expect(await failed.limit()).toBe(HARDWARE_SESSION_LIMITS.minimum);
  });

  it('shares one per-user folder across processes, outside userData', () => {
    // A Mac's temp folder is per user; on Linux /tmp is shared, so the folder is the login session's runtime one.
    const runtime = process.env['XDG_RUNTIME_DIR'];
    const expected =
      process.platform === 'darwin' || process.platform === 'win32'
        ? join(tmpdir(), 'taalcut-hardware-sessions')
        : runtime
          ? join(runtime, 'taalcut-hardware-sessions')
          : join(tmpdir(), `taalcut-hardware-sessions-${process.getuid?.() ?? 0}`);
    expect(hardwareSessionDir()).toBe(expected);
  });

  it('the jobs and render processes both put the gated runner in their media contexts', async () => {
    const jobs = testJobs(testConfig('jobs'), 31);
    roots.push(jobs);
    const render = await composeRender(testConfig('render'), 32);
    roots.push(render);
    for (const root of [jobs, render]) {
      expect(root.container.has(HardwareSessionsToken)).toBe(true);
      const context = sessionContext(root.container);
      expect(context.hardwareSessions).toBe(root.container.resolve(HardwareSessionsToken));
      expect(typeof context.runner).toBe('function');
    }
  });
});
