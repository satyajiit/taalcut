// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The exec sandbox holds the app-wide hardware session cap around each run
 * (the desktop adapts media's gate; tools may not import media). The runs
 * here are a tenth of a second of CPU lavfi to the null muxer: no hardware
 * session is opened.
 */
import { join } from 'node:path';
import { err, ok, ValidationError } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SandboxHardwareSessions } from '@taalcut/tools';
import { confinedSkipReason, execSandbox, experimentId, skipMessage, tempRoot } from './helpers/sandbox';

const skip = confinedSkipReason();
skipMessage('sandbox hardware sessions', skip);

let temp: { root: string; cleanup: () => void };
beforeEach(() => {
  temp = tempRoot();
});
afterEach(() => temp.cleanup());

const TINY = ['-f', 'lavfi', '-i', 'color=red:size=64x64:duration=0.1', '-f', 'null', '-'];

describe.skipIf(skip !== '')('sandbox hardware sessions', { timeout: 60_000 }, () => {
  it('holds a lease for the run and gives it back when the child exits', async () => {
    const calls: { program: string; args: readonly string[] }[] = [];
    let held = 0;
    const hardwareSessions: SandboxHardwareSessions = (program, args) => {
      calls.push({ program, args });
      held++;
      return Promise.resolve(ok({ release: () => Promise.resolve(void held--) }));
    };
    const { sandbox } = execSandbox(join(temp.root, 'root'), { hardwareSessions });
    const id = experimentId();
    await sandbox.open({ id, projectId: null, purpose: 'analysis' });
    const result = await sandbox.run(id, { program: 'ffmpeg', args: TINY });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.program).toBe('ffmpeg');
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['lavfi', 'null']));
    expect(held).toBe(0);
  });

  it("records the program's pid with its lease, so the slot stays held while it runs (IX3-F5 H4, IX3-F7)", async () => {
    const adopted: number[] = [];
    const hardwareSessions: SandboxHardwareSessions = () =>
      Promise.resolve(
        ok({
          release: () => Promise.resolve(),
          adopt: (pid: number) => void adopted.push(pid),
        }),
      );
    const { sandbox } = execSandbox(join(temp.root, 'root'), { hardwareSessions });
    const id = experimentId();
    await sandbox.open({ id, projectId: null, purpose: 'analysis' });
    const result = await sandbox.run(id, { program: 'ffmpeg', args: TINY });
    expect(result.ok).toBe(true);
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toBeGreaterThan(0);
  });

  it('starts nothing when no session can be had', async () => {
    const refused = ValidationError({ field: 'hardwareSessions' });
    const { sandbox } = execSandbox(join(temp.root, 'root'), {
      hardwareSessions: () => Promise.resolve(err(refused)),
    });
    const id = experimentId();
    await sandbox.open({ id, projectId: null, purpose: 'analysis' });
    const result = await sandbox.run(id, { program: 'ffmpeg', args: TINY });
    expect(!result.ok && result.error.code).toBe(refused.code);
  });
});
